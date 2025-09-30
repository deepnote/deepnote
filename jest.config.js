module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/packages"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["packages/*/src/**/*.ts", "!**/*.test.ts"],
};
