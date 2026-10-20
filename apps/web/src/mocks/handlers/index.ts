import { developerHandlers } from "./developer";
import { auditorHandlers } from "./auditor";
import { arbiterHandlers } from "./arbiter";
import { selectHandlers } from "./live";

export const handlers = selectHandlers(
  [...developerHandlers, ...auditorHandlers, ...arbiterHandlers],
  process.env.NEXT_PUBLIC_LIVE_PIPELINE === "enabled",
);
