import { developerHandlers } from "./developer";
import { auditorHandlers } from "./auditor";
import { arbiterHandlers } from "./arbiter";

export const handlers = [...developerHandlers, ...auditorHandlers, ...arbiterHandlers];
