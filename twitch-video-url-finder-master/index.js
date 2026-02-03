const puppeteer = require('puppeteer');

async function findVideoUrl(clipUrl, browserExecutablePath, browserArgs) {
    const browser = await puppeteer.launch({
        headless: true,
        executablePath: browserExecutablePath,
        args: browserArgs
    });

    const page = await browser.newPage();
    await page.goto(clipUrl, { waitUntil: 'networkidle2' });

    const url = await page.evaluate('document.querySelector("video").getAttribute("src")')

    await browser.close();

    return url.length > 0 ? url : false;
}

module.exports = function (browserExecutablePath, browserArgs) {
    return async function (clipUrl) {
        return {
            url: await findVideoUrl(clipUrl, browserExecutablePath, browserArgs)
        };
    }
};
