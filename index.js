const path = require('path');
const fs = require('fs');
const https = require('https');
const core = require('@actions/core');
const cache = require('@actions/tool-cache');
const child_process = require('child_process');

const API_URL = 'https://api.github.com/repos/AnnikaCodes/ziglint/releases/latest';
const MAX_TRIES = 3;

async function run(command, cwd = process.cwd()) {
    return new Promise((resolve, reject) => {
        child_process.exec(command, {cwd}, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve({stdout, stderr});
            }
        });
    });
}

/**
 * @returns {Promise<string>} the path to the build ziglint binary
 */
async function buildZiglintFromSource(binaryName) {
    // we already have Zig installed from the setup-zig action
    // clone the Ziglint source by running `git clone https://github.com/AnnikaCodes/ziglint.git`
    await run('git clone https://github.com/AnnikaCodes/ziglint.git');

    // build the binary by running `zig build -Doptimize=ReleaseFast`
    await run('zig build -Doptimize=ReleaseFast', 'ziglint');

    // check that the binary works
    const ziglintPath = path.resolve(path.join(process.cwd(), 'ziglint', 'zig-out', 'bin', 'ziglint'));
    fs.copyFileSync(ziglintPath, binaryName);
    const {stdout} = await run(`${binaryName} version`);
    const version = stdout.trim();
    core.info(`Successfully built ziglint ${version}`);
    return path.resolve(path.join(process.cwd(), binaryName));
}

async function handleNoReleases(binaryName) {
    core.info(`Building ziglint from source...`);
    const built = await buildZiglintFromSource(binaryName);
    core.addPath(built);
    core.info(`Added ${built} to the path.`);
}

(async () => {
    try {
        const binaryName = process.argv[2] || 'ziglint';
        const token = process.argv[3] || '';

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
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
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
                const cachedBinary = cache.find(name, '*');
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

        if (!latestRelease.name) {
            core.warning(`Unable to find latest ziglint release.`);
            await handleNoReleases(binaryName);
            return;
        }

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
            core.warning(`ziglint release ${latestRelease.name} is not available for your platform (${name} not found)`);
            await handleNoReleases(binaryName);
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
