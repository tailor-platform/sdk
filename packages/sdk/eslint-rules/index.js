import { rule as requirePublicApiJsdoc } from "./require-public-api-jsdoc.js";

/** @type {import('eslint').ESLint.Plugin} */
export default {
  rules: {
    "require-public-api-jsdoc": requirePublicApiJsdoc,
  },
};
