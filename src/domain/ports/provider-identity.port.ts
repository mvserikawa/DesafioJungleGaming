export const PROVIDER_IDENTITY_PORT = Symbol('PROVIDER_IDENTITY_PORT');

export abstract class ProviderIdentityPort {
  public abstract validateProvider(providerId: string, token?: string): Promise<boolean>;
}
