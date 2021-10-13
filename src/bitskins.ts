// eslint-disable-next-line import/no-unresolved
import * as nodered from 'node-red';
import phin from 'phin';
import { TOTP } from 'otpauth';
import qs from 'querystring';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Pusher = require('pusher-client');

interface WebsocketConfig extends nodered.NodeDef {
  eventType: string;
}

interface ApiCredentials {
  apiKey: string;
  otpSecret: string;
}

interface ApiConfig extends nodered.NodeDef {
  url: string;
}

interface ApiPayload {
  url?: string;
  queryParams: qs.ParsedUrlQueryInput;
}

const BITSKINS_APP_KEY = 'c0eef4118084f8164bec65e6253bf195';
const DEFAULT_CHANNEL = 'inventory_changes';
const EVENT_TYPES = ['listed', 'delisted_or_sold', 'price_changed', 'extra_info'];

export = function (RED: nodered.NodeAPI): void {
  function websocketNode(this: nodered.Node, config: WebsocketConfig): void {
    RED.nodes.createNode(this, config);
    const pusher = new Pusher(BITSKINS_APP_KEY, {
      encrypted: true,
      wsPort: 443,
      wssPort: 443,
      host: 'notifier.bitskins.com',
    });

    const channel = pusher.subscribe(DEFAULT_CHANNEL);

    config.eventType.split(',').forEach((eventType) => {
      channel.bind(eventType, (data: any) => {
        const msg: Record<string, any> = { topic: eventType, channel: DEFAULT_CHANNEL };
        if (Object.prototype.hasOwnProperty.call(data, 'payload')) {
          msg.payload = data.payload;
        } else {
          msg.payload = data;
        }
        this.send(msg);
      });
    });
  }

  RED.nodes.registerType('bitskins-websocket', websocketNode);

  function apiNode(this: nodered.Node<ApiCredentials>, config: ApiConfig): void {
    RED.nodes.createNode(this, config);
    const { apiKey, otpSecret } = this.credentials;

    let otpAuth: TOTP | undefined;
    if (otpSecret) {
      otpAuth = new TOTP({
        secret: otpSecret,
      });
    }

    this.on('input', async (msg, send, done) => {
      // do something with 'msg'

      const payload = msg.payload as ApiPayload;

      const queryParams: qs.ParsedUrlQueryInput = {
        ...payload.queryParams,
        api_key: apiKey,
      };
      if (otpAuth) {
        queryParams.code = otpAuth.generate();
      }

      const apiResponse = await phin({
        method: 'post',
        url: `${payload.url || config.url}?${qs.stringify(queryParams)}`,
        parse: 'json',
      });

      const respMsg = msg;
      respMsg.payload = apiResponse.body;

      send(respMsg);
      done();
    });
  }
  RED.nodes.registerType<nodered.Node<ApiCredentials>, ApiConfig, unknown, unknown>(
    'bitskins-api',
    apiNode,
    {
      credentials: {
        apiKey: { type: 'text', required: true },
        otpSecret: { type: 'text', required: false },
      },
    }
  );
};
