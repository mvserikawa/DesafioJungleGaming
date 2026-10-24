export const PROVIDER_IDENTITY_PORT = Symbol('PROVIDER_IDENTITY_PORT');

export interface ProviderIdentityPort {
  validateProvider(providerId: string, token?: string): Promise<boolean>;
}
