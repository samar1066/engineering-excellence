import { Duration, RemovalPolicy, Tags } from "aws-cdk-lib";
import {
  AccountRecovery,
  AdvancedSecurityMode,
  UserPool as CognitoUserPool,
  Mfa,
  type UserPoolClient,
} from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface UserPoolProps {
  /**
   * The owner tag applied to the pool for cost attribution. It comes from the stage that
   * instantiates the pool rather than being typed here, so every resource in a deployment inherits a
   * consistent owner and a bill can be grouped by it.
   */
  readonly owner: string;
  /** The environment tag applied to the pool, for the same reason as owner. */
  readonly environment: string;
  /**
   * The physical pool name. Left undefined by default so CloudFormation names the pool and two
   * stages never collide on one name; set it when an existing pool must be adopted by name.
   */
  readonly userPoolName?: string;
  /**
   * The removal policy for the pool. A user directory defaults to RETAIN so a stack deletion never
   * takes the only copy of the identities with it; a throwaway stage can pass DESTROY deliberately.
   */
  readonly removalPolicy?: RemovalPolicy;
}

/**
 * A Cognito user pool and a public app client for the identity domain, carrying the properties the
 * auth laws demand: a strong password policy, advanced security enforcement, email sign-in and
 * recovery, an app client scoped to the minimal auth flows, and owner plus environment tags.
 *
 * It is a plain Construct rather than a Stack, so the aws-cdk service stack composes it beside the
 * service the pool authenticates. The properties that prove the laws are declared explicitly rather
 * than left to an account default, so they are visible in the rendered template and a template
 * assertion can hold them in place. The pool encrypts its directory at rest with AWS managed keys
 * and serves every endpoint over TLS, neither of which is a template knob; what the construct adds
 * on top, and what the assertions pin, is the credential and least privilege posture.
 */
export class UserPool extends Construct {
  public readonly pool: CognitoUserPool;
  public readonly client: UserPoolClient;

  constructor(scope: Construct, id: string, props: UserPoolProps) {
    super(scope, id);

    this.pool = new CognitoUserPool(this, "Pool", {
      userPoolName: props.userPoolName,
      // Email is the sign-in identifier, so there is no separate username to remember, and it is
      // verified before it can be used, so a sign-in name is always a reachable inbox.
      signInAliases: { email: true, username: false },
      signInCaseSensitive: false,
      // Open self sign-up is off by default: registration is an application concern that decides who
      // may create an account, not a door left open on the directory.
      selfSignUpEnabled: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      // A strong password floor of twelve characters across four character classes. Cognito stores
      // only a salted hash and never the password itself, and this floor keeps that stored secret
      // expensive to reverse.
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      // Recovery is by verified email only, with no SMS fallback a SIM swap could hijack.
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // Advanced security runs adaptive authentication and compromised credential detection on every
      // sign-in: the security defaults that harden the directory beyond its at-rest encryption.
      advancedSecurityMode: AdvancedSecurityMode.ENFORCED,
      mfa: Mfa.OPTIONAL,
      mfaSecondFactor: { sms: false, otp: true },
      deletionProtection: true,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.RETAIN,
    });

    this.client = this.pool.addClient("AppClient", {
      // A public client for a browser or mobile front end: it holds no static secret that could
      // leak, and it signs users in with SRP so the password never crosses the wire. Only the SRP
      // and refresh flows are enabled; the admin and plain-password flows are left off, so the
      // client can do exactly what a first-party sign-in needs and nothing more.
      generateSecret: false,
      authFlows: {
        userSrp: true,
        userPassword: false,
        adminUserPassword: false,
        custom: false,
      },
      // A failed sign-in returns the same answer whether or not the account exists, so the pool is
      // not a directory an attacker can enumerate.
      preventUserExistenceErrors: true,
      // No hosted-UI OAuth flows: this is a first-party SRP client, so the authorization-code and
      // implicit grants, their broad default scopes, and the placeholder callback are all switched
      // off. The client is left with exactly the two flows a first-party sign-in uses.
      oAuth: {
        flows: {
          authorizationCodeGrant: false,
          implicitCodeGrant: false,
          clientCredentials: false,
        },
        scopes: [],
        callbackUrls: [],
        logoutUrls: [],
      },
      // Short-lived bearer tokens: an access token ages out within the hour, so an intercepted token
      // is useful only briefly, and a longer-lived refresh token is exchanged over TLS to renew it.
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    Tags.of(this.pool).add("Owner", props.owner);
    Tags.of(this.pool).add("Environment", props.environment);
  }
}
