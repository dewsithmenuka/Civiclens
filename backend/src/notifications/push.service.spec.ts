import {
  FcmPushService,
  PushPayload,
} from './push.service';

interface FakeResponse {
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
}

const fake = (responses: FakeResponse[]) =>
  new FcmPushService(
    'unused',
    async () => ({
      sendEachForMulticast: async () => ({
        responses,
      }),
    }),
  );

const payload: PushPayload = {
  title: 't',
  body: 'b',
};

const ok: FakeResponse = {
  success: true,
};

const fail = (
  code: string,
  message = 'boom',
): FakeResponse => ({
  success: false,
  error: {
    code,
    message,
  },
});

describe('FcmPushService result mapping', () => {
  it('reports success with no invalid tokens and no failures', async () => {
    expect(
      await fake([ok, ok]).send(
        ['a', 'b'],
        payload,
      ),
    ).toEqual({
      invalidTokens: [],
      failures: [],
    });
  });

  it('flags unregistered / invalid tokens for deletion', async () => {
    const result = await fake([
      ok,
      fail(
        'messaging/registration-token-not-registered',
      ),
      fail(
        'messaging/invalid-registration-token',
      ),
    ]).send(
      ['a', 'b', 'c'],
      payload,
    );

    expect(result.invalidTokens).toEqual([
      'b',
      'c',
    ]);

    expect(result.failures).toEqual([]);
  });

  it('surfaces credential/outage errors instead of pretending the push was accepted', async () => {
    const result = await fake([
      fail(
        'app/invalid-credential',
        'bad key',
      ),
    ]).send(
      ['a'],
      payload,
    );

    expect(result.invalidTokens).toEqual([]);

    expect(result.failures).toEqual([
      {
        code: 'app/invalid-credential',
        message: 'bad key',
      },
    ]);
  });

  it('separates dead tokens from other failures in one batch', async () => {
    const result = await fake([
      ok,
      fail(
        'messaging/registration-token-not-registered',
      ),
      fail(
        'messaging/server-unavailable',
      ),
    ]).send(
      ['a', 'b', 'c'],
      payload,
    );

    expect(result.invalidTokens).toEqual([
      'b',
    ]);

    expect(
      result.failures.map(
        (failure) => failure.code,
      ),
    ).toEqual([
      'messaging/server-unavailable',
    ]);
  });

  it('does nothing for an empty token list', async () => {
    expect(
      await fake([]).send([], payload),
    ).toEqual({
      invalidTokens: [],
      failures: [],
    });
  });
});
