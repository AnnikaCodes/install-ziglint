const path = require('path');
const fs = require('fs');
const https = require('https');
const core = require('@actions/core');
const cache = require('@actions/tool-cache')

const API_URL = 'https://api.github.com/repos/AnnikaCodes/ziglint/releases/latest';
const MAX_TRIES = 5;

(async () => {
    try {
        const binaryName = core.getInput('binary-name');

        let os = process.platform;
        if (os === 'win32') os = 'windows';
        if (os === 'darwin') os = 'macos';

        let arch = process.arch;
        if (arch === 'x64') arch = 'x86_64';
        if (arch === 'arm64') arch = 'aarch64';

        let name = `ziglint-${os}-${arch}`;
        if (os === 'windows') name += '.exe';
        core.info(`Looking for ${name}...`);

        const headers = {'User-Agent': 'install-ziglint GitHub Action'};
        if (core.getInput('token')) {
            headers['Authorization'] = `Bearer ${core.getInput('token')}`;
        }
        const getAPIResponse = async () => {
            return new Promise((resolve, reject) => {
                https.get(
                    API_URL,
                    {headers},
                    (response) => {
                        let data = '';
                        response.on('data', (chunk) => {
                            data += chunk;
                        });
                        response.on('end', () => {
                            resolve(JSON.parse(data));
                        });
                    },
                ).on('error', (e) => reject(e));
            });
        };
        // make a JSON request to the GitHub API
        let latestRelease;
        let tries = 1;
        do {
            latestRelease = await getAPIResponse();
            tries++;

            if (latestRelease.message?.includes('API rate limit exceeded')) {
                // use *any* cached version instead
                const cachedBinary = cache.find(name, '');
                if (cachedBinary) {
                    core.warning(`GitHub API rate limit exceeded; using cached ${name} instead`);
                    core.warning(`This may be an older version than the latest ziglint release!`);
                    core.addPath(cachedBinary);
                    return;
                }

                if (tries > MAX_TRIES) {
                    core.error('GitHub API rate limit exceeded too many times; aborting.');
                } else {
                    // 20, 40, 80, 160, 320 seconds
                    const wait = 10 * 2**tries;
                    core.warning(`GitHub API rate limit exceeded; retrying in ${wait} seconds...`);
                    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
                }
            }
        } while (tries < MAX_TRIES);
        // skip download if this version is cached
        const cachedBinary = cache.find(name, latestRelease.name);
        if (cachedBinary) {
            core.info(`Using cached ziglint version ${latestRelease.name}`);
            core.addPath(cachedBinary);
            return;
        }

        core.debug(`Data: ${JSON.stringify(latestRelease)}`);
        core.info(`Latest release is ${latestRelease.name}`);
        const asset = latestRelease.assets.find(asset => asset.name === name);
        if (!asset) {
            core.setFailed(`ziglint release ${latestRelease.name} is not available for your platform (${name} not found)`);
            return;
        }

        const downloadUrl = asset.browser_download_url;
        core.info(`Downloading ${downloadUrl}...`);
        const binaryPath = await cache.downloadTool(downloadUrl, binaryName);
        core.info(`Successfully downloaded to ${binaryName}`);

        // make it executable
        if (os !== 'windows') fs.chmodSync(binaryPath, 0o755);
        const toAdd = path.resolve(process.cwd());
        core.addPath(toAdd);
        core.info(`Successfully added ${toAdd} to PATH`);

        // cache it
        await cache.cacheFile(binaryPath, name, name, latestRelease.name);
        core.info(`Successfully cached ${name} to key '${latestRelease.name}'`);
    } catch (error) {
        core.setFailed(error.message);
    }
})();
