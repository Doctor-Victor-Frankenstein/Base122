// Read over https://github.com/mathiasbynens/base64 and maybe webkit implementation for ideas on
// performance improvements.

let base64 = require('base-64')
, fs = require('fs')
, specials = [
    0 // null
    , 10 // newline                
    , 13 // carriage return
    , 34 // double quote
    , 92 // backslash
];
let assert = require('assert');
const kDebug = false
, kString = 0
, kUint8Array = 1
, kHeader = 0b00001111 // Enforce odd and greater than 13 to avoid special chars.
, kShortened = 0b01000000
;

function debugLog() {
    if (kDebug) console.log(...arguments);
}

function encodeFromBase64(base64String) {
    return encode(base64.decode(base64String));
}

// rawData may be a string (similar to btoa) or a Uint8Array. Returns a base123 encoded string.
function encode(rawData) {
    let dataType = typeof(rawData) == 'string' ? kString : kUint8Array;
    var curIndex = 0, curMask = 0b10000000, stringData = [];
    var bitsFound = 0;

    // Returns false when no more bits are left.            
    function getOne() {
        if (curIndex >= rawData.length) return false;
        let curByte = dataType == kString ? rawData.codePointAt(curIndex) : rawData[curIndex];
        bit = (curByte & curMask) > 0 ? 1 : 0;
        bitsFound++;

        curMask = curMask >>> 1;
        if (curMask == 0) {
            curIndex++;
            curMask = 0b10000000
        }
        return bit;
    }
    
    function get7() {
        if (curIndex >= rawData.length) return false;
        var b = 0;
        for (var i = 0; i < 7; i++) {
            b = b << 1;
            var bit = getOne();
            if (bit === false) continue; // Still want to return whatever we have, left shifted.
            b |= bit;
        }
        return b;
    }
    var header = kHeader;
    while(true) {
        // Grab 7 bits.
        var bits = get7();
        if (bits === false) break;
        var specialIndex = specials.indexOf(bits);
        if (specialIndex != -1) {
            debugLog('Special time for bits ', bits.toString(2), bits);
            var b1 = 0b11000010, b2 = 0b10000000;
            b1 |= (0b111 & specialIndex) << 2;
            // See if there are any bits after this special sequence.
            // If there are, then there can be a variable range of 7 bits in last bit of
            // special byte and remaining 6 in other.
            // Otherwise, there are a variable number of 7 in the special code. Either way,
            // % 8 should chop off the excess.
            var nextBits = get7();
            if (nextBits === false) {
                debugLog(' Special code contains the last 7ish bits.');
                header |= kShortened;
            } else {
                debugLog(' There are additional bits', nextBits.toString(2))
                // Push first bit onto first byte, remaining 6 onto second.
                var firstBit = (nextBits & 0b01000000) > 0 ? 1 : 0;
                debugLog(firstBit, nextBits.toString(2), nextBits & 0b01000000, b1.toString(2));
                b1 |= firstBit;
                debugLog(b1.toString(2));
                b2 |= nextBits & 0b00111111;
            }
            stringData.push(b1);
            stringData.push(b2);
            debugLog(' Unicode character is ', b1.toString(2), b2.toString(2));
        } else {
            stringData.push(bits);
        }
    }
    // Add header byte to front.
    stringData.unshift(header);
    return stringData;
}

function encodeFile(filepath) {
    // TODO.
    // POC
    let contents = fs.readFileSync(filepath, {encoding: 'utf-8'});
    let encoding = encode(base64.decode(contents));
    let encodingStr = String.fromCharCode(...encoding);
    fs.writeFileSync(filepath + '.base123', encodingStr, {encoding: 'binary'});
}

encodeFile('base64example.txt');


// Bitwise order of operations (according to MDN)
// ~ << >> >>> & ^ |
// Subtraction (-) comes before all.
// Base for web function.
function decodeString(strData) {
    let decoded = [];
    let curByte = 0;
    let bitOfByte = 0;
    let header = strData.charCodeAt(0);

    function push7(byte) {
        byte <<= 1;
        // Align this byte to offset for current byte.
        curByte = curByte | byte >>> bitOfByte;
        // Explanation:
        bitOfByte += 7;
        if (bitOfByte >= 8) {
            decoded.push(curByte);
            bitOfByte -= 8;
            // Now, take the remainder, left shift by what has been taken.
            curByte = byte << 7 - bitOfByte & 255;
        }
        debugLog('Decoded[] = ', decoded);
    }
    
    for (var i = 1; i < strData.length; i++) {
        let c = strData.charCodeAt(i);

        // Check for a leading 1 bit, indicating a two-byte character.
        if (c > 127) {
            // Note, the charCodeAt will give the codePoint, thus
            // 0b110xxxxx 0b10yyyyyy will give => xxxxxyyyyyy
            debugLog('Two byte code', c.toString(2));
            
            var specialIndex = c >>> 8 & 7; // 7 = 0b111. Note, >>> precedes &
            debugLog(specialIndex);
            debugLog('Special index', specialIndex, specialIndex.toString(2));
            debugLog('Special inflated to ', specials[specialIndex].toString(2));
            push7(specials[specialIndex]);

            // Skip the remainder only if this is the last character and the header says so.
            if (i == strData.length - 1 && (header & kShortened)) continue;
            push7(c & 0x7F); // Note order of operations.
        } else {
            // Regular ascii.
            debugLog('Adding', c, c.toString(2));
            push7(c);
        }
    }
    return decoded;
}

function decode(rawData) {
    let dataType = typeof(rawData) == 'string' ? kString : kUint8Array;
    if (dataType == kUint8Array) return decodeString(Buffer.from(rawData).toString('utf-8'));
    return decodeString(rawData);
}

module.exports = {
    encode: encode,
    decode: decode,
    encodeFile: encodeFile
};
