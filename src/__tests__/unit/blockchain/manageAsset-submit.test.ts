import { jest } from '@jest/globals';

const getStatus = jest.fn<() => Promise<any>>();
const submit = jest.fn<() => Promise<any>>();
const getResult = jest.fn();
const endorse = jest.fn<() => Promise<any>>();
const newProposal = jest.fn();
const getContract = jest.fn();
const getNetwork = jest.fn<() => Promise<any>>();
const gatewayClose = jest.fn();
const clientClose = jest.fn();

jest.unstable_mockModule(
  new URL('../../../blockchain/fabric/v3/connect.ts', import.meta.url).pathname,
  () => ({
  newGrpcConnection: jest.fn(async () => ({ close: clientClose })),
  newGatewayConnection: jest.fn(async () => ({
    getNetwork,
    close: gatewayClose,
  })),
  }),
);

const { ManageAsset } = await import('../../../blockchain/fabric/v3/manageAsset');

describe('ManageAsset Fabric submit', () => {
  beforeEach(() => {
    getResult.mockReturnValue(Buffer.from('{"ok":true}'));
    getStatus.mockResolvedValue({
      blockNumber: 3n,
      code: 0,
      successful: true,
      transactionId: 'tx-committed',
    });
    submit.mockResolvedValue({ getStatus });
    endorse.mockResolvedValue({ submit, getResult });
    newProposal.mockReturnValue({ endorse });
    getContract.mockReturnValue({ newProposal });
    getNetwork.mockResolvedValue({ getContract });
  });

  test('waits for a successful commit before closing the Fabric session', async () => {
    const manager = new ManageAsset('consentAccess', {
      channelName: 'health-care-local',
      chaincodeName: 'consentaccess-sc',
    });

    await expect(manager.submit('Org1MSP', 'upsertConsentAccess', 'rule-1', '{}'))
      .resolves.toEqual({ ok: true });

    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(gatewayClose).toHaveBeenCalledTimes(1);
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(getStatus.mock.invocationCallOrder[0]).toBeLessThan(gatewayClose.mock.invocationCallOrder[0]);
  });

  test('rejects an invalid commit instead of reporting a successful write', async () => {
    getStatus.mockResolvedValue({
      blockNumber: 4n,
      code: 11,
      successful: false,
      transactionId: 'tx-invalid',
    });
    const manager = new ManageAsset('consentAccess', {
      channelName: 'health-care-local',
      chaincodeName: 'consentaccess-sc',
    });

    await expect(manager.submit('Org1MSP', 'upsertConsentAccess', 'rule-1', '{}'))
      .rejects.toThrow(/tx-invalid.*validation code 11/);

    expect(gatewayClose).toHaveBeenCalledTimes(1);
    expect(clientClose).toHaveBeenCalledTimes(1);
  });
});
