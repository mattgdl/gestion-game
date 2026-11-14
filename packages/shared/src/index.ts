export * from "./rng";
export * from "./noise";
export * from "./types";
export * from "./terrain";
export * from "./messages";

/**
 * Version du format de sauvegarde. À incrémenter à chaque changement de format,
 * en ajoutant la migration correspondante dans client/src/save/save.ts.
 */
export const SAVE_VERSION = 2;
