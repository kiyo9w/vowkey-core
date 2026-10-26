const { pathsToModuleNameMapper } = require("ts-jest");

const { compilerOptions } = require("../../tsconfig.base");

const sharedConfig = require("../../libs/shared/jest.config.angular");

/** @type {import('jest').Config} */
module.exports = {
  ...sharedConfig,
  setupFilesAfterEnv: ["<rootDir>/test.setup.ts"],
  moduleNameMapper: {
    // Replace ESM SDK with Node compatible SDK
    "@vowkey/common/platform/services/sdk/default-sdk-client-factory":
      "<rootDir>/../../libs/common/spec/jest-sdk-client-factory",
    ...pathsToModuleNameMapper(
      {
        // lets us use @vowkey/common/spec in web tests
        "@vowkey/common/spec": ["libs/common/spec"],
        ...(compilerOptions?.paths ?? {}),
      },
      {
        prefix: "<rootDir>/../../",
      },
    ),
  },
};
