import circleFactoryAbiJson from "./abis/CircleFactory.json" with { type: "json" };
import circleAbiJson from "./abis/Circle.json" with { type: "json" };
import reputationRegistryAbiJson from "./abis/ReputationRegistry.json" with { type: "json" };
import mockStableAbiJson from "./abis/MockStable.json" with { type: "json" };
// Export as const-narrowed tuples so viem can statically infer event/function names.
export const circleFactoryAbi = circleFactoryAbiJson;
export const circleAbi = circleAbiJson;
export const reputationRegistryAbi = reputationRegistryAbiJson;
export const mockStableAbi = mockStableAbiJson;
export { addresses } from "./addresses.js";
