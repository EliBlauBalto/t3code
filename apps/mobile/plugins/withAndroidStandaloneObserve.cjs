const { withSettingsGradle } = require("expo/config-plugins");

module.exports = function withAndroidStandaloneObserve(config) {
  return withSettingsGradle(config, (nextConfig) => {
    const marker = "expoAutolinking.useExpoModules()";
    const exclusion =
      "expoAutolinking.exclude = (expoAutolinking.exclude ?: []) + ['expo-observe']";
    const contents = nextConfig.modResults.contents;
    if (!contents.includes(exclusion)) {
      if (!contents.includes(marker)) throw new Error("Expo autolinking settings were not found");
      nextConfig.modResults.contents = contents.replace(marker, `${exclusion}\n${marker}`);
    }
    return nextConfig;
  });
};
