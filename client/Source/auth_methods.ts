export interface SavedMainAuthEcdsaIdentity {
    ecdsaIdentity: {
        username: string;
        publicKeyRaw: string;
        encryptedIdentityKey: string;
        encryptedIdentityKeyIV: string;
    };
}
// TODO: These names are all a mouthful. We need something shorter for MainAuth

export interface SavedMainAuthGuest {
    guest: {
        identifier: string;
    };
}

export interface SavedMainAuthMissing {
    missing: Record<string, never>;
}

export type SavedMainAuth = SavedMainAuthEcdsaIdentity | SavedMainAuthGuest | SavedMainAuthMissing;

export interface SavedExtraSecuritySecretPhrase {
    secretPhrase: {
        secret: string;
    };
}
// TODO: These names are all a mouthful. We need something shorter for ExtraSecurity

export interface SavedExtraSecurityJWK {
    jwk: Record<string, never>;
}

export type SavedExtraSecurity = SavedExtraSecuritySecretPhrase | SavedExtraSecurityJWK;
