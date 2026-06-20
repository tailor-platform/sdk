const config = { tailor: "custom" };

const { [config.tailor]: configuredValue } = globalThis;
const { [getKey("tailor")]: dynamicValue } = globalThis;

export { configuredValue, dynamicValue };
