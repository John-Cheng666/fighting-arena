import { CharacterRegistry } from "../engine/characters";
import { jamieModule } from "./jamie/module";

/** Builtins are composed here. Adding a module never requires changes to the match kernel. */
export const characters = new CharacterRegistry([jamieModule]);
