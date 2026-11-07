import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const MAX_ICON_DATA_URL = 400_000;

export const appearanceSchema = z
  .object({
    displayName: z.string().max(80),
    iconDataUrl: z.string().max(MAX_ICON_DATA_URL).nullable(),
  })
  .strict();

export const rpcContract = defineRpcContract({
  getAppearance: { input: z.null(), output: appearanceSchema },
  setIcon: {
    input: z.object({ iconDataUrl: z.string().max(MAX_ICON_DATA_URL).nullable() }).strict(),
    output: appearanceSchema,
  },
});

export type Appearance = z.infer<typeof appearanceSchema>;
