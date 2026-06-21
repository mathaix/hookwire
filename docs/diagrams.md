# Hookwire Diagrams

These Mermaid diagrams describe the current MVP architecture and the intended v1 flows. They are kept in source control so GitHub can render them in pull requests and documentation.

## System Architecture

```mermaid
flowchart LR
    subgraph client ["Local and User Surfaces"]
        reviewer["Web reviewer"]
        agentRuntime["AI agent runtime"]
        installer["Hookwire installer"]
        relay["Local relay"]
        policyCache["Local policy cache"]
    end

    subgraph gateway ["Backend Entry Points"]
        webApp["Next.js web app"]
        relayApi["Relay HTTP API"]
    end

    subgraph service ["Core Services"]
        onboardingService["Onboarding service"]
        policyService["Policy and route service"]
        approvalService["Approval service"]
        auditService["Audit service"]
        integrationService["Integration adapter framework"]
    end

    subgraph datastore ["Canonical Store"]
        postgres["Postgres"]
    end

    subgraph external ["External Providers"]
        slack["Slack"]
        sms["SMS"]
        jira["Jira"]
        linear["Linear"]
        email["Email"]
        github["GitHub"]
        webhook["Webhook receivers"]
    end

    subgraph async ["Optional Future Bus"]
        nats["NATS JetStream"]
    end

    reviewer -->|"HTTPS"| webApp
    agentRuntime -->|"Hook events"| relay
    installer -->|"Configures hooks"| relay
    relay -->|"Reads cached policy"| policyCache
    relay -->|"Signed approval request"| relayApi
    webApp -->|"Onboarding and config"| onboardingService
    webApp -->|"Policies and routes"| policyService
    webApp -->|"Decisions"| approvalService
    relayApi -->|"Create and poll approvals"| approvalService
    onboardingService -->|"Writes identities"| postgres
    policyService -->|"Reads and writes rules"| postgres
    approvalService -->|"Reads and writes approvals"| postgres
    auditService -->|"Appends audit events"| postgres
    approvalService -.->|"Future publish"| nats
    nats -.->|"Future delivery events"| integrationService
    integrationService -.->|"Provider APIs"| slack
    integrationService -.->|"Provider APIs"| sms
    integrationService -.->|"Provider APIs"| jira
    integrationService -.->|"Provider APIs"| linear
    integrationService -.->|"Provider APIs"| email
    integrationService -.->|"Provider APIs"| github
    integrationService -.->|"Provider APIs"| webhook
```

## Canonical Identity and Approval Records

```mermaid
flowchart LR
    subgraph service ["Services"]
        onboardingService["Onboarding service"]
        relayApi["Relay API"]
        decisionApi["Decision API"]
        auditService["Audit service"]
    end

    subgraph datastore ["Postgres Tables"]
        users["users"]
        memberships["memberships"]
        projects["projects"]
        agentTools["agent_tools"]
        agentInstallations["agent_installations"]
        installationCredentials["installation_credentials"]
        agentSessions["agent_sessions"]
        hookEvents["hook_events"]
        routes["routes"]
        routeTargets["route_targets"]
        approvalRequests["approval_requests"]
        approvalDecisions["approval_decisions"]
        auditEvents["audit_events"]
        relayNonces["relay_request_nonces"]
    end

    onboardingService -->|"Creates and links"| users
    onboardingService -->|"Creates membership"| memberships
    onboardingService -->|"Creates project"| projects
    onboardingService -->|"Registers tool"| agentTools
    onboardingService -->|"Registers installation"| agentInstallations
    onboardingService -->|"Stores public key"| installationCredentials
    relayApi -->|"Records nonce"| relayNonces
    relayApi -->|"Creates session event"| hookEvents
    relayApi -->|"Creates approval"| approvalRequests
    decisionApi -->|"Records reviewer decision"| approvalDecisions
    auditService -->|"Appends event"| auditEvents
    memberships -->|"Belongs to"| users
    projects -->|"Scoped by"| memberships
    agentTools -->|"For project"| projects
    agentInstallations -->|"Installs tool"| agentTools
    installationCredentials -->|"Authenticates"| agentInstallations
    agentSessions -->|"Runs through"| agentInstallations
    hookEvents -->|"Belongs to session"| agentSessions
    routes -->|"Targets"| routeTargets
    approvalRequests -->|"Uses route"| routes
    approvalRequests -->|"References hook event"| hookEvents
    approvalDecisions -->|"Decides request"| approvalRequests
```

## Onboarding and Key Registration

```mermaid
sequenceDiagram
    title Onboarding and key registration
    participant User
    participant WebApp
    participant BackendAPI
    participant Postgres
    participant Installer
    participant LocalRelay

    User->>WebApp: Start onboarding
    WebApp->>BackendAPI: Create organization and project
    BackendAPI->>Postgres: Insert org, project, membership
    Postgres-->>BackendAPI: Tenant ids
    BackendAPI-->>WebApp: Device-code challenge
    User->>Installer: Run hookwire login
    Installer->>LocalRelay: Generate Ed25519 keypair
    Installer->>BackendAPI: Register public key
    BackendAPI->>Postgres: Insert agent tool, installation, credential
    Postgres-->>BackendAPI: Installation credential id
    BackendAPI-->>Installer: Registration complete
    Installer->>LocalRelay: Write hook config and private key path
```

## Signed Relay Approval Request

```mermaid
sequenceDiagram
    title Signed relay approval request
    participant AgentRuntime
    participant LocalRelay
    participant RelayAPI
    participant Postgres
    participant WebInbox
    participant Reviewer
    participant DecisionAPI

    AgentRuntime->>LocalRelay: Tool-use event
    LocalRelay->>LocalRelay: Evaluate cached policy
    LocalRelay->>LocalRelay: Redact payload
    LocalRelay->>RelayAPI: POST /api/relay/approvals
    RelayAPI->>Postgres: Verify credential, nonce, tenant binding
    RelayAPI->>Postgres: Insert hook event and approval request
    Postgres-->>RelayAPI: approvalRequestId
    RelayAPI-->>LocalRelay: 201 pending
    Reviewer->>WebInbox: Review pending request
    WebInbox->>DecisionAPI: POST approve or deny
    DecisionAPI->>Postgres: Insert decision and audit event
    Postgres-->>DecisionAPI: Decision row
    DecisionAPI-->>WebInbox: Decision recorded
    LocalRelay->>RelayAPI: GET decision
    RelayAPI-->>LocalRelay: approved or denied
```

## Future External Integration Delivery

```mermaid
sequenceDiagram
    title Future provider delivery
    participant RelayAPI
    participant RouteService
    participant Postgres
    participant IntegrationWorker
    participant Slack
    participant Reviewer
    participant DecisionAPI
    participant AuditService

    RelayAPI->>RouteService: Resolve route targets
    RouteService->>Postgres: Read routes and route targets
    Postgres-->>RouteService: Web inbox and provider targets
    RouteService-->>RelayAPI: Delivery plan
    RelayAPI->>Postgres: Insert approval delivery rows
    RelayAPI-->>IntegrationWorker: Delivery work item
    IntegrationWorker->>Slack: Send approval message
    Slack-->>Reviewer: Approval prompt
    Reviewer->>Slack: Approve or deny
    Slack->>DecisionAPI: Signed callback
    DecisionAPI->>Postgres: Insert canonical decision
    DecisionAPI->>AuditService: Record provider decision
    AuditService->>Postgres: Append audit event
    DecisionAPI-->>Slack: Update message state
```
