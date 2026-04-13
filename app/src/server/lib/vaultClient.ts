import axios, { AxiosInstance, AxiosError, Method } from 'axios';
import https from 'https';

export class VaultError extends Error {
  public statusCode: number;
  public errors: string[];

  constructor(message: string, statusCode: number, errors: string[] = []) {
    super(message);
    this.name = 'VaultError';
    this.statusCode = statusCode;
    this.errors = errors;
  }
}

export class VaultClient {
  private client: AxiosInstance;

  constructor(vaultAddr: string, skipTlsVerify = false) {
    this.client = axios.create({
      baseURL: `${vaultAddr}/v1`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      ...(skipTlsVerify && {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }),
    });
  }

  async request<T = unknown>(
    method: Method,
    path: string,
    token: string,
    data?: unknown
  ): Promise<T> {
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['X-Vault-Token'] = token;
      }
      const response = await this.client.request<T>({
        method,
        url: path.startsWith('/') ? path : `/${path}`,
        headers,
        data,
      });
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        const status = error.response?.status || 500;
        const vaultErrors: string[] =
          error.response?.data?.errors || [];
        const message =
          vaultErrors.length > 0
            ? vaultErrors.join(', ')
            : error.message;
        throw new VaultError(message, status, vaultErrors);
      }
      throw new VaultError(
        error instanceof Error ? error.message : 'Unknown Vault error',
        500
      );
    }
  }

  async get<T = unknown>(path: string, token: string): Promise<T> {
    return this.request<T>('GET', path, token);
  }

  async post<T = unknown>(
    path: string,
    token: string,
    data: unknown
  ): Promise<T> {
    return this.request<T>('POST', path, token, data);
  }

  async put<T = unknown>(
    path: string,
    token: string,
    data: unknown
  ): Promise<T> {
    return this.request<T>('PUT', path, token, data);
  }

  async delete<T = unknown>(path: string, token: string): Promise<T> {
    return this.request<T>('DELETE', path, token);
  }

  async list<T = unknown>(path: string, token: string): Promise<T> {
    return this.request<T>('LIST' as Method, path, token);
  }

  /**
   * Stream a binary response from Vault (e.g. Raft snapshot).
   * Returns an axios response with a Node.js readable stream as data.
   */
  async getStream(path: string, token: string) {
    const url = `${this.client.defaults.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
    const axiosModule = await import('axios');
    const response = await axiosModule.default.get(url, {
      headers: { 'X-Vault-Token': token },
      responseType: 'stream',
      httpsAgent: this.client.defaults.httpsAgent,
      timeout: 120000,
    });
    return response;
  }

  /**
   * POST binary data to Vault (e.g. Raft snapshot restore).
   */
  async postBinary(path: string, token: string, data: Buffer): Promise<void> {
    const url = `${this.client.defaults.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
    const axiosModule = await import('axios');
    try {
      await axiosModule.default.post(url, data, {
        headers: {
          'X-Vault-Token': token,
          'Content-Type': 'application/octet-stream',
        },
        httpsAgent: this.client.defaults.httpsAgent,
        timeout: 120000,
      });
    } catch (error) {
      const axiosError = error as import('axios').AxiosError;
      if (axiosError.response) {
        const errData = axiosError.response.data as { errors?: string[] } | null;
        const msgs = errData?.errors ?? [];
        throw new VaultError(msgs.join(', ') || axiosError.message, axiosError.response.status, msgs);
      }
      throw new VaultError(error instanceof Error ? error.message : 'Unknown Vault error', 500);
    }
  }
}
