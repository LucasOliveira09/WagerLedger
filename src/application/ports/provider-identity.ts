export interface ProviderIdentityRequest {
  declaredProviderId: string;
  authorization?: string;
}

export abstract class ProviderIdentityPort {
  abstract assertIdentity(request: ProviderIdentityRequest): Promise<void>;
}

// Entrega sem IdP: não autentica. O adaptador OIDC futuro deve comparar a identidade
// verificada do token com declaredProviderId; o domínio segue validando o provedor.
export class DeclaredProviderIdentity extends ProviderIdentityPort {
  override async assertIdentity(): Promise<void> {}
}
