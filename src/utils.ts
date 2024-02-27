import { EEncoding, IData } from './interface';

/**
 * Accepts any base64 string and attempts to decode it.
 * If run through the browser `atob` will be used, otherwise
 * the code will use `Buffer.from`.
 * If there's an error the original string will be returned.
 * @param str String to be decoded
 * @returns Decoded string
 */
export const decodeBase64 = (str: string): string => {
    try {
        let result = str;

        if (typeof atob === 'undefined') {
            result = Buffer.from(str, 'base64').toString('binary');
        } else {
            result = atob(str);
        }

        return result;
    } catch (error) {
        return str;
    }
};

export const isJSON = (data: string): boolean => {
    try {
        JSON.parse(data);
        return true;
    } catch (error) {
        return false;
    }
}


/**
 * Rebuild to ensure trailing slashes or encoded characters match.
 * @param url Any URL
 */
export const rebuildUrl = (url: string): string => {
    const original = new URL(url);
    return original.protocol + '//' + original.host + original.pathname + original.search + original.hash;
}

export const urlHasParams = (url: string): boolean => {
    return new URL(url).searchParams.toString().length > 0;
}

const urlDecoderIdentity = (decoded: string) => decoded;
const urlDecoders: Record<EEncoding, (decoded: string) => string> = {
    [EEncoding.base32]: urlDecoderIdentity,
    [EEncoding.base45]: urlDecoderIdentity,
    
    // Simple base64 decoding
    [EEncoding.base64]: (decoded: string) => decodeBase64(decoded),
    [EEncoding.binary]: urlDecoderIdentity,
    [EEncoding.hex]: (decoded: string) => {
        let hex = decoded.toString();
        let out = '';

        for (var i = 0; i < hex.length; i += 2) {
            out += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
        }

        return out;
    },
    
    // Decode uri when used in URL parameters
    [EEncoding.url]: (decoded: string) => decodeURI(decoded),

    // This is more of a special case but it may help other rules. See issue #72
    [EEncoding.url2]: (decoded: string) => decodeURIComponent(decoded.replace(/-/g, '%')).replace(/_/g, '/').replace(/%2F/g, '/'),
    
    // decodeURIComponent
    [EEncoding.urlc]: (decoded: string) => decodeURIComponent(decoded),
}

export const decodeUrl = (str: string, encoding: EEncoding = EEncoding.base64): string => {
    return urlDecoders[encoding](str);
}

export const getDifferenceBetweenUrls = (data: IData, url: string) => {
    const oldUrl = new URL(url);
    const newUrl = new URL(data.url);

    return {
        isNewHost: oldUrl.host !== newUrl.host,
        difference: url.length - data.url.length,
        reduction: +(100 - (data.url.length / url.length) * 100).toFixed(2)
    };
}

/**
 * Determine if the input is a valid URL or not
 * @param url Any URL
 * @returns true/false
 */
export const validateUrl = (url: string): boolean => {
    try {
        const pass = ['http:', 'https:'];
        const test = new URL(url);
        const prot = test.protocol.toLowerCase();

        if (!pass.includes(prot)) {
            throw new Error('Not acceptable protocol: ' + prot);
        }

        return true;
    } catch (error) {
        if (url !== 'undefined' && url !== 'null' && url.length > 0) {
            throw new Error(`Invalid URL: ` + url);
        }
        return false;
    }
}