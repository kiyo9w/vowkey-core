import { ConsoleLogService } from "@vowkey/common/platform/services/console-log.service";

import MainBackground from "../background/main.background";

const logService = new ConsoleLogService(false);
const vowkeyMain = ((self as any).vowkeyMain = new MainBackground());
vowkeyMain.bootstrap().catch((error) => logService.error(error));
