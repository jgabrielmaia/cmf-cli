#!/usr/bin/env node

"use strict";

const path = require('path'),
    mkdirp = require('mkdirp'),
    envPaths = require('env-paths'),
    rimraf = require('rimraf'),
    fs = require('fs'),
    axios = require('axios'),
    AdmZip = require("adm-zip"),
    tmp = require('tmp'),
    node_modules = require('node_modules-path'),
    { parsePackageJson, PLATFORM_MAPPING, ARCH_MAPPING } = require('./utils');

async function getInstallationPath() {
    if (!!process.env.npm_config_global) {
        // install into home:
        // win: /AppData/Local/CMF/cmf-cli
        // linux: ~/.local/share/cmf-cli
        // osx: ~/Library/Application Support/cmf-cli
        const paths = envPaths("cmf-cli", {suffix: ""});
        await mkdirp(paths.data);
        return paths.data;
    } else {
        // install into node_modules/.bin/cmf-cli
        const value = path.join(node_modules(), ".bin");
        const dir = path.join(value, "cmf-cli");
        return dir;
    }
}

async function verifyAndPlaceBinary(binName, binPath, callback) {
    if (!fs.existsSync(path.join(binPath, binName))) return callback('Downloaded binary does not contain the binary specified in configuration - ' + binName);
    return callback(null);
}

/**
 * Reads the configuration from application's package.json,
 * validates properties, copied the binary from the package and stores at
 * ./bin in the package's root. NPM already has support to install binary files
 * specific locations when invoked with "npm install -g"
 *
 *  See: https://docs.npmjs.com/files/package.json#bin
 */
var INVALID_INPUT = "Invalid inputs";
async function install(callback) {

    var opts = parsePackageJson(".");
    if (!opts) return callback(INVALID_INPUT);
    console.info(`Copying the relevant binary for your platform ${process.platform}`);
    const src= `./dist/${PLATFORM_MAPPING[process.platform]}-${ARCH_MAPPING[process.arch]}`;

    if (!fs.existsSync("./dist")) {
        // download respective release zip from github
        const pkgUrl = opts.binUrl.replace("{{version}}", opts.version).replace("{{platform}}", PLATFORM_MAPPING[process.platform]).replace("{{arch}}", ARCH_MAPPING[process.arch]);
        console.info(`Getting release archive from ${pkgUrl} into ${path.resolve(src)}`);
        try {
            const response = await axios({
                url: pkgUrl,
                method: 'GET',
                responseType: 'arraybuffer', // to do this with streaming we must deal with chunking
            });
            const zip = tmp.tmpNameSync();
            console.log(zip);
            fs.writeFileSync(zip, response.data);
            (new AdmZip(zip)).extractAllTo(src);
        } catch {
            callback(`Could not find release for version ${opts.version} on your platform ${process.platform}/${process.arch}`);
        }
    }

    const installPath = await getInstallationPath();
    if (process.platform === "win32") {
        await execShellCommand(`robocopy ${src.replace(/\//g, "\\")} "${installPath}" /e /is /it`, [1]);
    } else {
        await execShellCommand(`cp -r ${src}/** "${installPath}"`);
        await execShellCommand(`chmod +x "${installPath}/cmf"`);
    }
    
    await verifyAndPlaceBinary(opts.binName, installPath, callback);
}

async function uninstall(callback) {
    var opts = parsePackageJson(".");
    try {
        const installationPath = await getInstallationPath();
        rimraf.sync(installationPath);
    } catch (ex) {
        console.log(ex);
        callback(ex);
        // Ignore errors when deleting the file.
    }
    console.info("Uninstalled cli successfully");
    return callback(null);
}

// Parse command line arguments and call the right method
var actions = {
    "install": install,
    "uninstall": uninstall
};
/**
 * Executes a shell command and return it as a Promise.
 * @param cmd {string}
 * @return {Promise<string>}
 */
function execShellCommand(cmd, valid_error_codes = null) {
    const exec = require('child_process').exec;
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                let shouldPrint = true;
                if (valid_error_codes != null) {
                    shouldPrint = valid_error_codes.indexOf(error.code) < 0;
                }
                shouldPrint && console.warn(error);
            }
            resolve(stdout? stdout : stderr);
        });
    });
}

var argv = process.argv;
if (argv && argv.length > 2) {
    var cmd = process.argv[2];
    if (!actions[cmd]) {
        console.log("Invalid command. `install` and `uninstall` are the only supported commands");
        process.exit(1);
    }

    actions[cmd](function (err) {
        if (err) {
            console.error(err);
            process.exit(1);
        } else {
            process.exit(0);
        }
    });
}
