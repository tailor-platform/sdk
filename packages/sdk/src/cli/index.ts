#!/usr/bin/env node

import { register } from "node:module";
import { runMain } from "citty";
import { mainCommand } from "./main-command";

register("tsx", import.meta.url, { data: {} });

runMain(mainCommand);
