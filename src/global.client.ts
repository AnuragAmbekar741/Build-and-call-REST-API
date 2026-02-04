import axios, { AxiosError, AxiosResponse, AxiosInstance } from "axios";

export type ApiClientOptions = {
  baseUrl: string;
  apiKey?: string;
  timeOutMs?: number;
};

export function createApiClient(opts: ApiClientOptions): AxiosInstance {
  const client = axios.create({
    baseURL: opts.baseUrl,
    timeout: opts.timeOutMs ?? 15_000,
    headers: {
      "Content-Type": "application/json",
    },
    validateStatus: () => true,
  });

  client.interceptors.request.use((config) => {
    if (opts.apiKey) {
      config.headers = config.headers ?? {};
      config.headers["Authorization"] = `Bearer ${opts.apiKey}`;
    }
    return config;
  });

  client.interceptors.response.use(
    (resp: AxiosResponse) => resp,
    (error: AxiosError) => Promise.reject(error)
  );

  return client;
}
