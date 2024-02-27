import { IRule, IData, EEncoding } from './interface';
import { handlers } from './handlers';
import { decodeUrl, isJSON, rebuildUrl, urlHasParams, getDifferenceBetweenUrls, validateUrl } from './utils';

const $github = 'https://github.com/DrKain/tidy-url';

export class TidyCleaner {
    public rules: IRule[] = [];
    /**
     * Don't log anything to the console.
     */
    public silent = true;

    /**
     * There's a whole number of reasons why you don't want AMP links,
     * too many to fit in this description.
     * See this link for more info: https://redd.it/ehrq3z
     */
    public allowAmp = false;
    /**
     * Used to auto-redirect to a different URL based on the parameter.
     * This is used to skip websites that track external links.
     */
    public allowRedirects = true;
    /**
     * Custom handlers for specific websites that use tricky URLs
     * that make it harder to "clean"
     */
    public allowCustomHandlers = true;

    public loglines: string[] = [];

    get expandedRules() {
        return this.rules.map((rule) => {
            return Object.assign(
                {
                    rules: [],
                    replace: [],
                    exclude: [],
                    redirect: '',
                    amp: null,
                    decode: null
                },
                rule
            ) as IRule;
        });
    }

    constructor() {
        // Load the rules
        try {
            this.rules = require('../data/rules.js');
        } catch (error) {
            this.log(`${error}`);
            this.rules = [];
        }
    }

    /**
     * Only log to the console if debug is enabled
     * @param str Message
     */
    private log(str: string) {
        this.loglines.push(str);
        if (!this.silent) console.log(str);
    }

    private matchRules(data: IData, original: URL): string[] {
        let remove: string[] = [];

        // Loop through the rules and match them to the host name
        for (const rule of this.expandedRules) {
            // Match the host or the full URL
            let match_s = original.host;
            if (rule.matchHref) match_s = original.href;
            // Reset lastIndex
            rule.match.lastIndex = 0;
            if (rule.match.exec(match_s) !== null) {
                // Loop through the rules and add to to_remove
                remove = [...remove, ...(rule.rules || [])];
                data.info.replace = [...data.info.replace, ...(rule.replace || [])];
                data.info.match.push(rule);
            }
        }

        return remove;
    }

    private handleRedirects(data: IData, original: URL, cleanerCi: URLSearchParams, allowReclean: boolean) {
        for (const rule of data.info.match) {
            if (!rule.redirect) continue;

            const target = rule.redirect;
            let value = cleanerCi.get(target) as string;

            // Sometimes the parameter is encoded
            const isEncoded = decodeUrl(value, EEncoding.urlc);
            if (isEncoded !== value && validateUrl(isEncoded)) value = isEncoded;

            if (target.length && cleanerCi.has(target)) {
                if (validateUrl(value)) {
                    data.url = `${value}` + original.hash;
                    if (allowReclean) data.url = this.clean(data.url, false).url;
                } else {
                    this.log('[error] Failed to redirect: ' + value);
                }
            }
        }
    }

    private removeAmp(data: IData, allowReclean: boolean) {
        for (const rule of data.info.match) {
            try {
                // Ensure the amp rule matches
                if (rule.amp && data.url.match(rule.amp)) {
                    // Reset the lastIndex
                    rule.amp.lastIndex = 0;
                    const result = rule.amp.exec(data.url);
                    if (result && result[1]) {
                        // If there is a result, replace the URL
                        let target = decodeURIComponent(result[1]);
                        if (!target.startsWith('https')) target = 'https://' + target;
                        if (validateUrl(target)) {
                            data.url = allowReclean ? this.clean(target, false).url : target;
                            if (data.url.endsWith('%3Famp')) data.url = data.url.slice(0, -6);
                            if (data.url.endsWith('amp/')) data.url = data.url.slice(0, -4);
                        }
                    }
                }
            } catch (error) {
                this.log(`${error}`);
            }
        }
    }

    private handleDecodes(data: IData, original: URL, allowReclean: boolean) {
        const cleaner = original.searchParams;
        const pathname = original.pathname;

        for (const rule of data.info.match) {
            try {
                if (!rule.decode) continue;
                // Make sure the target parameter exists
                if (!cleaner.has(rule.decode.param) && rule.decode.targetPath !== true) continue;
                // These will always be clickjacking links, so use the allowRedirects rule
                if (!this.allowRedirects) continue;
                // Decode the string using selected encoding
                const encoding = rule.decode.encoding || 'base64';
                // Sometimes the website path is what we need to decode
                let lastPath = pathname.split('/').pop();
                // This will be null if the param doesn't exist
                const param = cleaner.get(rule.decode.param);
                // Use a default string
                let encodedString: string = '';

                // Decide what we are decoding
                if (param === null && lastPath !== undefined) encodedString = lastPath;
                else if (param) encodedString = param;
                else continue;

                if (typeof encodedString !== 'string') {
                    this.log(`[error] Expected ${encodedString} to be a string`);
                    continue;
                }

                let decoded = decodeUrl(encodedString, encoding);
                let target = '';
                let recleanData = null;

                // If the response is JSON, decode and look for a key
                if (isJSON(decoded)) {
                    const json = JSON.parse(decoded);
                    target = json[rule.decode.lookFor];
                    // Add to the info response
                    data.info.decoded = json;

                } else if (this.allowCustomHandlers && rule.decode.handler) {
                    // Run custom URL handlers for websites
                    const handler = handlers[rule.decode.handler];

                    if (typeof handler === 'undefined') {
                        this.log('[error] Handler was not found for ' + rule.decode.handler);
                    }

                    if (rule.decode.handler && handler) {
                        data.info.handler = rule.decode.handler;
                        const result = handler.exec(data.url, [decoded]);

                        // If the handler threw an error or the URL is invalid
                        if (result.error || !validateUrl(result.url)) {
                            if (result.url !== 'undefined') this.log('[error] ' + result.error);
                        }

                        recleanData = result.url;
                    } else {
                        // If the response is a string we can continue
                        target = decoded;
                    }
                }

                // Re-clean the URL after handler result
                if (allowReclean) target = this.clean(recleanData ?? target, false).url;

                // If the key we want exists and is a valid url then update the data url
                if (target && target !== '' && validateUrl(target)) {
                    data.url = `${target}` + original.hash;
                }
            } catch (error) {
                this.log(`[error] ${error}`);
            }
        }
    }

    /**
     * Clean a URL
     * @param _url Any URL
     * @returns IData
     */
    public clean(_url: string, allowReclean = true): IData {
        if (!allowReclean) this.loglines = [];

        // Default values
        const data: IData = {
            url: _url,
            info: {
                original: _url,
                reduction: 0,
                difference: 0,
                replace: [],
                removed: [],
                handler: null,
                match: [],
                decoded: null,
                isNewHost: false,
                fullClean: false
            }
        };

        // Make sure the URL is valid before we try to clean it
        if (!validateUrl(_url)) {
            if (_url !== 'undefined') this.log('[error] An invalid URL was supplied');
            return data;
        }

        // If there's no params, we can skip the rest of the process
        if (this.allowAmp && !urlHasParams(_url)) {
            data.url = data.info.original;
            return data;
        }

        // Rebuild to ensure trailing slashes or encoded characters match
        let url = rebuildUrl(_url);
        data.url = url;

        const original = new URL(url);
        const originalSearchParams = original.searchParams;
        const originalPathname = original.pathname;

        const cleanerCi = new URLSearchParams();

        // Case insensitive cleaner for the redirect rule
        originalSearchParams.forEach((v, k) => cleanerCi.append(k.toLowerCase(), v));

        const remove = this.matchRules(data, original);

        // Stop cleaning if any exclude rule matches
        let ex_pass = true;
        for (const rule of data.info.match) {
            for (const reg of rule.exclude) {
                reg.lastIndex = 0;
                if (reg.exec(url) !== null) ex_pass = false;
            }
        }

        if (!ex_pass) {
            data.url = data.info.original;
            return data;
        }

        // Check if the match has any amp rules, if not we can redirect
        const hasAmpRule = data.info.match.find((item) => item.amp);
        if (this.allowAmp && hasAmpRule === undefined) {
            // Make sure there are no parameters before resetting
            if (!urlHasParams(url)) {
                data.url = data.info.original;
                return data;
            }
        }

        // Delete any matching parameters
        for (const key of remove) {
            if (!originalSearchParams.has(key)) continue;
            data.info.removed.push({ key, value: originalSearchParams.get(key) as string });
            originalSearchParams.delete(key);
        }

        // Update the pathname if needed
        for (const key of data.info.replace) {
            const changed = originalPathname.replace(key, '');
            if (changed !== originalPathname) originalPathname = changed;
        }

        // Rebuild URL
        data.url = original.protocol + '//' + original.host + originalPathname + original.search + original.hash;

        // Redirect if the redirect parameter exists
        if (this.allowRedirects) {
            this.handleRedirects(data, original, cleanerCi, allowReclean);
        }

        // De-amp the URL
        if (!this.allowAmp) {
            this.removeAmp(data, allowReclean);
        }

        // Decode handler
        this.handleDecodes(data, original, allowReclean);

        // Handle empty hash / anchors
        if (_url.endsWith('#')) {
            data.url += '#';
            url += '#';
        }

        // Remove empty values when requested
        for (const rule of data.info.match) {
            if (rule.removeEmptyValues) data.url = data.url.replace(/=(?=&|$)/gm, '');
        }

        const diff = getDifferenceBetweenUrls(data, url);
        data.info = Object.assign(data.info, diff);

        // If the link is longer then we have an issue
        if (data.info.reduction < 0) {
            this.log(`[error] Reduction is ${data.info.reduction}. Please report this link on GitHub: ${$github}/issues`);
            data.url = data.info.original;
        }

        data.info.fullClean = true;

        // Reset the original URL if there is no change, just to be safe
        if (data.info.difference === 0 && data.info.reduction === 0) {
            data.url = data.info.original;
        }

        return data;
    }
}

export const TidyURL = new TidyCleaner();
export const clean = (url: string) => TidyURL.clean(url);
