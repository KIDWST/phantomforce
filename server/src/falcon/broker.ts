export type FalconBrokerConfig = {
  baseUrl: string;
};

export type FalconBroker = {
  describe: () => {
    baseUrl: string;
    boundary: "server-only";
    rawPassthrough: false;
  };
};

export function createFalconBroker(config: FalconBrokerConfig): FalconBroker {
  return {
    describe: () => ({
      baseUrl: config.baseUrl,
      boundary: "server-only",
      rawPassthrough: false,
    }),
  };
}
