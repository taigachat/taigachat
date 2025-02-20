export const DEFAULT_MESSAGE_TIME_FORMAT = "%H:%M";

function isLeapYear(year: number) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function zeroPad2(n: number) {
    const s = `${n}`;
    return s.length == 1 ? "0" + s : s;
}

function zeroPad3(n: number) {
    return `${1000 + n}`.slice(1);
}

const weekDays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];
const dayCount = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

export function strftime(formatString: string, date: Date) {
    if (formatString === DEFAULT_MESSAGE_TIME_FORMAT) {
        // Preinterpreted for that extra performance boost on lower-ended devices. :)
        return `${zeroPad2(date.getHours())}:${zeroPad2(date.getMinutes())}`;
    }

    const dayOfWeek = date.getDay();
    const dayOfMonth = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();
    const hour = date.getHours();

    function getThursday() {
        const target = new Date(date);
        target.setDate(dayOfMonth - ((dayOfWeek + 6) % 7) + 3);
        return target;
    }

    const conversions: Record<string, string> = {
        "%a": weekDays[dayOfWeek]!.slice(0, 3),
        "%A": "" + weekDays[dayOfWeek],
        "%b": months[month]!.slice(0, 3),
        "%B": "" + months[month],
        "%c": date.toUTCString(),
        "%C": "" + Math.floor(year / 100),
        "%d": zeroPad2(dayOfMonth),
        "%e": "" + dayOfMonth,
        "%F": date.toISOString().slice(0, 10),
        "%G": "" + getThursday().getFullYear(),
        "%g": (getThursday().getFullYear() + "").slice(2),
        "%H": zeroPad2(hour),
        "%I": zeroPad2(((hour + 11) % 12) + 1),
        "%j": zeroPad3(dayCount[month]! + dayOfMonth + (month > 1 && isLeapYear(year) ? 1 : 0)),
        "%k": "" + hour,
        "%l": "" + (((hour + 11) % 12) + 1),
        "%m": zeroPad2(month + 1),
        "%n": "" + (month + 1),
        "%M": zeroPad2(date.getMinutes()),
        "%p": hour < 12 ? "AM" : "PM",
        "%P": hour < 12 ? "am" : "pm",
        "%s": "" + Math.round(date.getTime() / 1000),
        "%S": zeroPad2(date.getSeconds()),
        "%u": "" + (dayOfWeek || 7),
        "%V": (function () {
            const target = getThursday();
            const n1stThu = target.valueOf();
            target.setMonth(0, 1);
            const nJan1 = target.getDay();
            if (nJan1 !== 4) {
                target.setMonth(0, 1 + ((4 - nJan1 + 7) % 7));
            }
            return zeroPad2(1 + Math.ceil((n1stThu - target.valueOf()) / 604800000));
        })(),
        "%w": "" + dayOfWeek,
        "%x": date.toLocaleDateString(),
        "%X": date.toLocaleTimeString(),
        "%y": (year + "").slice(2),
        "%Y": "" + year,
        "%z": date.toTimeString().replace(/.+GMT([+-]\d+).+/, "$1"),
        "%Z": date.toTimeString().replace(/.+\((.+?)\)$/, "$1"),
    };

    return formatString.replace(/%[a-z]/gi, (matchedWord) => conversions[matchedWord] || matchedWord);
}

/// Changes from original:
/// - Modernized the code to ES6
/// - Renamed the variables to better names
/// - Removed brain-dead hungarian notation
/// - Moved somethings out of the funciton
/// - Added a preinterpreted format string
/// - Solved some bugs

/// Original comment:
/* Port of strftime() by T. H. Doan (https://thdoan.github.io/strftime/)
 *
 * Day of year (%j) code based on Joe Orost's answer:
 * http://stackoverflow.com/questions/8619879/javascript-calculate-the-day-of-the-year-1-366
 *
 * Week number (%V) code based on Taco van den Broek's prototype:
 * http://techblog.procurios.nl/k/news/view/33796/14863/calculate-iso-8601-week-and-year-in-javascript.html
 */

/// Original license:
/*
MIT License

Copyright (c) 2016 Tom Doan

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
