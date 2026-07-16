import type { Abi } from "viem";

import circleFactoryAbiJson from "./abis/CircleFactory.json" assert { type: "json" };
import circleAbiJson from "./abis/Circle.json" assert { type: "json" };
import reputationRegistryAbiJson from "./abis/ReputationRegistry.json" assert { type: "json" };
import mockStableAbiJson from "./abis/MockStable.json" assert { type: "json" };

export const circleFactoryAbi = circleFactoryAbiJson as Abi;
export const circleAbi = circleAbiJson as Abi;
export const reputationRegistryAbi = reputationRegistryAbiJson as Abi;
export const mockStableAbi = mockStableAbiJson as Abi;

export { addresses } from "./addresses.js";
export type { Abi } from "viem";
