const { withStringsXml } = require("expo/config-plugins");

module.exports = function withAndroidDreamSettings(config) {
  const scheme = Array.isArray(config.scheme) ? config.scheme[0] : config.scheme;
  if (!scheme) throw new Error("The screen saver settings link needs an app scheme.");
  return withStringsXml(config, (next) => {
    const strings = (next.modResults.resources.string ??= []);
    const name = "t3_dream_settings_url";
    const value = `${scheme}://settings/desk-dashboard`;
    const existing = strings.find((entry) => entry.$.name === name);
    if (existing) existing._ = value;
    else strings.push({ $: { name, translatable: "false" }, _: value });
    return next;
  });
};
