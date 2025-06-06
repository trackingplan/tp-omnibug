/* globals module, require */
const sass = require("sass");

module.exports = function (grunt) {
    
    grunt.config.init({
        "extension": {
            "production": {
                "name": "Trackingplan Omnibug",
                "version": "1.0.0",
                "storageKey": "trackingplan-omnibug",
                "feedbackUrl": "https://github.com/trackingplan/tp-omnibug/issues",
                "analyticsID": "-"
            }
        },
        "chrome": {
            "folder": "chromium",
            "tracking": false
        },
        "edge": {
            "folder": "edge",
            "tracking": false
        },
        "firefox": {
            "folder": "firefox",
            "tracking": false
        },
        "clean": {
            "chrome": ["platform/chromium", "build/chrome_*.zip"],
            "edge": ["platform/edge", "build/edge_*.zip"],
            "firefox": ["platform/firefox", "build/firefox_*.zip"],
            "providers": ["src/providers.js", "src/serviceWorker-full.js"],
            "test": ["test/source/**"]
        },
        "watch": {
            "providers": {
                "files": ["src/providers/**"],
                "tasks": [
                    "build-test-providers",
                    "build-providers"
                ],
                "options": {
                    "spawn": false,
                },
            },
            "chrome": {
                "files": ["src/**"],
                "tasks": [
                    "clean:chrome",
                    "build-copy:chrome",
                    "chrome-manifest",
                    "build-concat:chrome"
                ],
                "options": {
                    "spawn": false,
                },
            },
            "edge": {
                "files": ["src/**"],
                "tasks": [
                    "clean:edge",
                    "build-copy:edge",
                    "edge-manifest",
                    "build-concat:edge"
                ],
                "options": {
                    "spawn": false,
                },
            },
            "firefox": {
                "files": ["src/**"],
                "tasks": [
                    "clean:firefox",
                    "build-copy:firefox",
                    "firefox-manifest",
                    "build-concat:firefox"
                ],
                "options": {
                    "spawn": false,
                },
            }
        },
        "pkg": grunt.file.readJSON("package.json"),
        "sass": {
            "options": {
                "implementation": sass,
                "sourceMap": false
            },
            "dist": {
                "files": {
                    "src/devtools/panel.css": "src/devtools/panel.scss",
                    "src/options/options.css": "src/options/options.scss"
                }
            }
        },
        "eslint": {
            "target": ["src/"]
        }
    });

    grunt.loadNpmTasks("grunt-contrib-copy");
    grunt.loadNpmTasks("grunt-contrib-compress");
    grunt.loadNpmTasks("grunt-contrib-clean");
    grunt.loadNpmTasks("grunt-contrib-concat");
    grunt.loadNpmTasks("grunt-contrib-watch");
    grunt.loadNpmTasks("grunt-text-replace");
    grunt.loadNpmTasks("grunt-sass");
    grunt.loadNpmTasks("grunt-eslint");

    grunt.registerTask("build-production", "Build the extensions", (browsers = "") => {
        let allowedBrowsers = ["chrome", "edge", "firefox"];
        if (browsers === "") {
            browsers = allowedBrowsers;
        } else {
            browsers = browsers.split(",");
        }
        grunt.task.run("build-providers");
        browsers.forEach((b) => {
            if (allowedBrowsers.indexOf(b) > -1) {
                grunt.task.run(
                    "clean:" + b + ":production",
                    "sass",
                    "build-copy:" + b + ":production",
                    b + "-manifest:production",
                    "build-concat:" + b + ":production",
                    "build-placeholders:" + b + ":production",
                    "build-compress:" + b + ":production"
                );
            } else {
                grunt.log.warn("Unknown browser " + b);
            }
        });
    });

    grunt.registerTask("chrome-manifest", "Build the Chrome manifest.json file", function (version = "production") {
        grunt.config.requires(`extension.${version}.version`);

        let browserOptions = grunt.config("chrome"),
            extensionOptions = grunt.config(`extension.${version}`),
            manifest = grunt.file.readJSON("src/manifest.json");

        manifest.name = extensionOptions.name;
        manifest.version = extensionOptions.version;

        // Remove anything that will break Chrome
        delete manifest.browser_specific_settings;
        delete manifest.background.scripts;

        grunt.file.write("platform/" + browserOptions.folder + "/manifest.json", JSON.stringify(manifest, null, 4));
        grunt.log.write("Created Chrome's manifest.json. ").ok();
    });

    grunt.registerTask("edge-manifest", "Build the Edge manifest.json file", function (version = "production") {
        grunt.config.requires(`extension.${version}.version`);

        let browserOptions = grunt.config("edge"),
            extensionOptions = grunt.config(`extension.${version}`),
            manifest = grunt.file.readJSON("src/manifest.json");

        manifest.name = extensionOptions.name;
        manifest.version = extensionOptions.version;

        // Remove anything that will break Edge
        delete manifest.browser_specific_settings;
        delete manifest.background.scripts;

        grunt.file.write("platform/" + browserOptions.folder + "/manifest.json", JSON.stringify(manifest, null, 4));
        grunt.log.write("Created Edge's manifest.json. ").ok();
    });

    grunt.registerTask("firefox-manifest", "Build the Firefox manifest.json file", function (version = "production") {
        grunt.config.requires(`extension.${version}.version`);

        let browserOptions = grunt.config("firefox"),
            extensionOptions = grunt.config(`extension.${version}`),
            manifest = grunt.file.readJSON("src/manifest.json");

        manifest.name = extensionOptions.name;
        manifest.version = extensionOptions.version;

        // Remove anything that will break Firefox's import routine
        delete manifest.minimum_chrome_version;
        delete manifest.background.service_worker;

        grunt.file.write("platform/" + browserOptions.folder + "/manifest.json", JSON.stringify(manifest, null, 4));
        grunt.log.write("Created Firefox's manifest.json. ").ok();
    });

    grunt.registerTask("build-copy", "Copy over the source files to the build directory", function (browser) {
        grunt.config.requires(browser);
        let options = grunt.config(browser),
            filesToCopy = ["serviceWorker-full.js", "providers.js", "options/*.*", "devtools/*.*", "assets/**", "libs/*.*", "!libs/OmnibugTracker.*", "popup/*.*", "pages/**", "!**/*.scss", "!assets/styles/**"],
            trackingLib = {
                expand: true,
                cwd: "src/libs/",
                src: [],
                dest: "./platform/" + options.folder + "/libs",
                rename: function (path, name) {
                    return path + "/OmnibugTracker.js";
                }
            };
        if (options.tracking) {
            trackingLib.src.push("OmnibugTracker.js");
        } else {
            trackingLib.src.push("OmnibugTracker.disabled.js");
        }

        grunt.config.set("copy." + browser, {
            files: [
                {
                    expand: true,
                    cwd: "src/",
                    src: filesToCopy,
                    dest: "./platform/" + options.folder
                },
                trackingLib
            ]
        });
        grunt.task.run("copy:" + browser);
    });

    grunt.registerTask("build-concat", "Concat build files for a browser", function (browser) {
        grunt.config.requires(browser);
        let options = grunt.config(browser);
        let destFiles = {},
            baseFiles = [];

        destFiles["platform/" + options.folder + "/options/options.js"] = baseFiles.concat(["src/options/options.js"]);
        destFiles["platform/" + options.folder + "/devtools/devtools.js"] = baseFiles.concat(["src/devtools/devtools.js"]);
        destFiles["platform/" + options.folder + "/devtools/panel.js"] = baseFiles.concat(["src/devtools/panel.js"]);
        grunt.config.set("concat." + browser, {
            files: destFiles
        });
        grunt.task.run("concat:" + browser);
    });

    grunt.registerTask("build-placeholders", "Update placeholders in built files", function (browser, version = "production") {
        grunt.config.requires(browser, `extension.${version}`);
        let browserOptions = grunt.config(browser),
            extensionOptions = grunt.config(`extension.${version}`),
            config = {
                "src": [
                    "platform/" + browserOptions.folder + "/manifest.json",
                    "platform/" + browserOptions.folder + "/**/*.js",
                    "platform/" + browserOptions.folder + "/*.js",
                    "platform/" + browserOptions.folder + "/**/*.html",
                    "platform/" + browserOptions.folder + "/*.html"
                ],
                "overwrite": true,
                "usePrefix": false,
                "replacements": [
                    {
                        "from": "##YEAR##",
                        "to": (new Date).getFullYear()
                    },
                    {
                        "from": "##OMNIBUG_VERSION##",
                        "to": extensionOptions.version
                    },
                    {
                        "from": "##OMNIBUG_NAME##",
                        "to": extensionOptions.name
                    },
                    {
                        "from": "##OMNIBUG_KEY##",
                        "to": extensionOptions.storageKey
                    },
                    {
                        "from": "##BROWSER##",
                        "to": browser
                    },
                    {
                        "from": "##OMNIBUG_FEEDBACK_URL##",
                        "to": extensionOptions.feedbackUrl
                    },
                    {
                        "from": "##OMNIBUG_UA_ACCOUNT##",
                        "to": extensionOptions.analyticsID
                    }
                ]
            };
        console.log("##OMNIBUG_VERSION## :: " + extensionOptions.version);
        grunt.config.set("replace." + browser, config);
        grunt.task.run("replace:" + browser);
    });

    grunt.registerTask("build-compress", "Compress build files into extension .zip", function (browser, version = "production") {
        grunt.config.requires(browser, `extension.${version}`);
        let options = grunt.config(browser),
            extensionOptions = grunt.config(`extension.${version}`);

        grunt.config.set("compress." + browser, {
            options: {
                archive: `./build/${browser}_${version}-${extensionOptions.version}.zip`
            },
            files: [
                {
                    expand: true,
                    cwd: "platform/" + options.folder,
                    src: ["**/*"],
                    dest: "/"
                }
            ]
        });
        grunt.task.run("compress:" + browser);
    });

    grunt.registerTask("build-test-files", "Build everything for testing", function () {

        grunt.config.set("concat.test-port", {
            "options": {
                "footer": "\nexport { OmnibugPort };"
            },
            "files": {
                "./test/source/OmnibugPort.js": [
                    "./src/libs/OmnibugPort.js",
                ]
            }
        });
        grunt.config.set("concat.test-settings", {
            "options": {
                "banner": "import { OmnibugProvider } from \"./providers.js\"\n",
                "footer": "\nexport { OmnibugSettings };"
            },
            "files": {
                "./test/source/OmnibugSettings.js": [
                    "./src/libs/OmnibugSettings.js",
                ]
            }
        });
        grunt.config.set("concat.test-helpers", {
            "options": {
                "footer": "\nexport { createElement, clearStyles, clearChildren };"
            },
            "files": {
                "./test/source/helpers.js": [
                    "./src/libs/helpers.js",
                ]
            }
        });
        grunt.config.set("concat.test-tracker", {
            "options": {
                "footer": "\nexport { OmnibugTracker };"
            },
            "files": {
                "./test/source/OmnibugTracker.js": [
                    "./src/libs/OmnibugTracker.js",
                ]
            }
        });

        /*
         * Splitting providers into 2 sections because:
         * 1) we should individually test each provider to verify it's returning the right data
         * 2) we still need to test the regex patterns to make sure that another provider isn't being greedy and matching what a different provider should
         * 
         * providers-test-individual sets up each provider with import/export under the /test/source/providers dir
         *
         * providers-test will setup the providers.js with all providers added to the OmnibugProvider object, and exports the OmnibugProvider
         */
        grunt.config.set("concat.providers-test-individual", {
            "options": {
                "banner": "const { URL } = require(\"url\");\n" +
                    "const URLSearchParams = require(\"@ungap/url-search-params\");\n",
                "process": function (source, filepath) {
                    var className = filepath.replace("./src/providers/", "").split(".")[0];
                    if (className === "OmnibugProvider") {
                        source = `const BaseProvider = require("./BaseProvider.js").default;\n` + source;
                        source = source.replace("var OmnibugProvider", "export var OmnibugProvider");
                    } else if (className === "BaseProvider") {
                        // do nothing for now
                    } else {
                        className += "Provider";
                        source = `const BaseProvider =  require("./BaseProvider.js").default;\n` + source;
                    }
                    source = source.replace(`class ${className}`, `export default class ${className}`);
                    return source;
                }
            },
            "files": {}
        });

        grunt.file.expand("./src/providers/*.js").forEach(function (fileName) {
            var className = fileName.replace("./src/providers/", "").split(".")[0],
                concat = grunt.config.get("concat.providers-test-individual");

            concat["files"][`./test/source/providers/${className}.js`] = fileName;
            grunt.config.set("concat.providers-test-individual", concat);
        });

        const sourceBasePath = "./src/providers/",
            ignoreFile = "!" + sourceBasePath + "providers.js";

        // Grab all of the provider names to append as an export list
        let providers = grunt.file.expand([sourceBasePath + "*.js", ignoreFile]).map((fileName) => {
            fileName = fileName.replace(sourceBasePath, "").split(".")[0];
            return fileName.indexOf("Provider") === -1 ? fileName + "Provider" : fileName;
        });

        // Load our providers into OmnibugProvider
        let providerInclude = [];
        providers.forEach((provider) => {
            if (["OmnibugProvider", "BaseProvider"].indexOf(provider) === -1) {
                providerInclude.push(`OmnibugProvider.addProvider(new ${provider}());`);
            }
        });

        grunt.config.set("concat.providers-test", {
            "options": {
                "banner": "const { URL } = require(\"url\");\n" +
                    "var URLSearchParams = require(\"@ungap/url-search-params\");\n",
                "footer": `\n${providerInclude.join("\n")}\nexport { OmnibugProvider };`
            },
            "files": {
                "./test/source/providers.js": [
                    sourceBasePath + "BaseProvider.js",
                    sourceBasePath + "OmnibugProvider.js",
                    sourceBasePath + "*.js",
                    ignoreFile
                ]
            }
        });

        grunt.task.run(["clean:test", "concat:providers-test", "concat:providers-test-individual", "concat:test-port", "concat:test-settings", "concat:test-helpers", "concat:test-tracker"]);
    });

    /**
     * Build providers for production usage
     *
     * This will build the providers for use within the plugin, NOT for testing
     */
    grunt.registerTask("build-providers", "Combine providers into a single file", function () {
        grunt.task.run("clean:providers");

        const sourceBasePath = "./src/providers/",
            ignoreFile = "!" + sourceBasePath + "providers.js";

        // Grab all of the provider names to append as an export list
        let providers = grunt.file.expand([sourceBasePath + "*.js", ignoreFile]).map((fileName) => {
            fileName = fileName.replace(sourceBasePath, "").split(".")[0];
            return fileName.indexOf("Provider") === -1 ? fileName + "Provider" : fileName;
        });

        // Load our providers into OmnibugProvider
        let providerInclude = [];
        providers.forEach((provider) => {
            if (["OmnibugProvider", "BaseProvider"].indexOf(provider) === -1) {
                providerInclude.push(`OmnibugProvider.addProvider(new ${provider}());`);
            }
        });

        grunt.config.set("concat.providers", {
            "options": {
                "footer": `\n${providerInclude.join("\n")}`
            },
            files: {
                "./src/providers.js": [
                    sourceBasePath + "BaseProvider.js",
                    sourceBasePath + "OmnibugProvider.js",
                    sourceBasePath + "*.js"
                ],
            }
        });
        grunt.task.run("concat:providers");

        grunt.config.set("concat.serviceWorker", {
            "options": { },
            files: {
                "./src/serviceWorker-full.js": [
                    "./src/libs/OmnibugPort.js",
                    "./src/libs/OmnibugSettings.js",
                    "./src/providers.js",
                    "./src/serviceWorker.js"
                ],
            }
        });
        grunt.task.run("concat:serviceWorker");
    });

    /*
     * Add aliases
     */
    grunt.registerTask("default", ["build-production"]);
    grunt.registerTask("build", ["build-production"]);
    grunt.registerTask("production", ["eslint", "build-production"]);
};
