import { developerHandlers } from "./developer";
import { auditorHandlers } from "./auditor";
import { arbiterHandlers } from "./arbiter";
import { chainHandlers } from "./chain";
import { selectHandlers } from "./live";

export const handlers = selectHandlers(
  [...chainHandlers, ...developerHandlers, ...auditorHandlers, ...arbiterHandlers],
  process.env.NEXT_PUBLIC_LIVE_PIPELINE === "enabled",
);
