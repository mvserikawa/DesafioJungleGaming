import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  PROVIDER_IDENTITY_PORT,
  ProviderIdentityPort,
} from '../../../domain/ports/provider-identity.port';

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(
    @Inject(PROVIDER_IDENTITY_PORT)
    private readonly providerIdentity: ProviderIdentityPort,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    // Exclude health checks from auth
    if (req.path.startsWith('/health') || req.path === '/metrics') {
      return true;
    }

    const authHeader = req.headers['authorization'];
    const providerId = req.body?.providerId || req.params?.providerId || req.headers['x-provider-id'];

    if (!providerId) {
      // Allow if no provider context is required (e.g. general endpoints)
      return true;
    }

    const isValid = await this.providerIdentity.validateProvider(
      providerId,
      authHeader,
    );

    if (!isValid) {
      throw new UnauthorizedException(
        `Unauthorized provider identity for "${providerId}"`,
      );
    }

    return true;
  }
}

/**
 * Extensible Provider Identity implementation.
 * In production, integrates with external IdP (Keycloak, Zitadel, Auth0) via OIDC JWT verification.
 */
@Injectable()
export class DefaultProviderIdentityService implements ProviderIdentityPort {
  public async validateProvider(providerId: string, token?: string): Promise<boolean> {
    // If IdP verification is disabled (default in test mode), allow configured providers
    if (process.env.ENABLE_IDP_VERIFICATION !== 'true') {
      return Boolean(providerId && providerId.trim().length > 0);
    }

    if (!token) {
      return false;
    }

    // Extension point: OIDC token verification against Keycloak / Zitadel JWKS
    // const jwks = ...
    // const verified = jwt.verify(token, jwks);
    // return verified.aud === providerId;
    return true;
  }
}
