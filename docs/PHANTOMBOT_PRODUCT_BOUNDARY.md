# PhantomBot product boundary

PhantomBot is the standalone consumer desktop product.

```text
PhantomBot product and distribution layer
  -> Hermes desktop and gateway adapters
  -> Hermes Agent kernel
  -> models, tools, skills, memory, terminals, browsers, channels

Optional connection:
PhantomBot <-> PhantomForce organization services
```

PhantomBot must install, launch, chat, operate tools, retain sessions and
memory, and manage providers without requiring PhantomForce OS. PhantomForce
integration is an optional governed organization/business layer, not the
desktop runtime or mandatory UI host.

Internal Hermes names remain where they are protocol, storage, compatibility,
or upstream implementation identifiers. Consumer-facing application identity,
installer identity, onboarding, primary navigation, and documentation use
PhantomBot. Nous Research attribution and the MIT license remain in every
distribution.

The previous `@phantomforce/phantombot-desktop` package in the PhantomForce
repository is an integration prototype, not the standalone PhantomBot product.
It must not be published to consumers as PhantomBot.
