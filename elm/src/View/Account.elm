module View.Account exposing (accountPanel)

{-| Account management panel — the in-app "You" dialog mirroring
`AccountPanel.tsx` (portal modal gated on the open flag; sections
for overview facts, signed-in devices, and this session).

C1 covers Overview / Devices / Session: the panel mount refreshes
`ACCOUNTINFO` + `SESSION LIST` through `SetAccountOpen`, and every
row reads the folds the audit slices landed. C2 adds Security
(TOTP enroll/confirm/disable with clipboard copy, certificate
bind/list/remove, transparency refresh), also refreshed on open.
C3 adds Email, Password, Recovery codes, Passkeys, and Data
(download record, save history, delete account). The delete confirm
renders inline in the panel where the oracle uses a Sheet modal.
-}

import App exposing (ConnectionState(..), Model, Msg(..), TotpCopy(..), TotpStatus(..), accountCertNotices, accountKeytransNotices, dropReady, isTotpCode, millisToIso, totpCodeLength)
import Html exposing (Html, a, button, code, dd, div, dl, dt, form, h2, h3, h4, input, label, li, nav, p, pre, section, span, strong, text, ul)
import Html.Attributes exposing (attribute, class, disabled, for, href, id, maxlength, pattern, placeholder, tabindex, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import Passkey exposing (maxLabelLength)
import Retention
import RuntimeDomain
import Session exposing (CapStatus(..), SessionState(..))
import View.Integrations


accountPanel : Model -> Html Msg
accountPanel model =
    if not model.accountOpen then
        text ""

    else
        div [ class "onyx-account-veil" ]
            [ div
                [ class "onyx-account"
                , attribute "role" "dialog"
                , attribute "aria-modal" "true"
                , attribute "aria-label" "Account settings"
                , attribute "data-testid" "account-panel"
                ]
                [ div [ class "onyx-account-head" ]
                    [ h2 [ class "onyx-account-title" ] [ text "Account settings" ]
                    , button
                        [ type_ "button"
                        , class "onyx-account-close"
                        , attribute "aria-label" "Close account settings"
                        , attribute "data-testid" "account-close"
                        , onClick (SetAccountOpen False)
                        ]
                        [ span [ attribute "aria-hidden" "true" ] [ text "✕" ] ]
                    ]
                , case model.accountName of
                    Nothing ->
                        p [ class "onyx-account-guest" ]
                            [ text "Sign in to manage your account." ]

                    Just _ ->
                        div []
                            [ sectionNav
                            , overviewSection model
                            , privateAccountStatusView model
                            , securitySection model
                            , certSection model
                            , keytransSection model
                            , deviceKeysSection model
                            , personasSection model
                            , if model.runtimeOwnerStamp /= Nothing then
                                privateManagementSection "Email address" "Enter the new address and current password in a private form. Server acceptance does not verify ownership of the new address."
                                    [ ( "account-email", "account-email", "Change email address" ) ]
                              else
                                emailSection model
                            , if model.runtimeOwnerStamp /= Nothing then
                                privateManagementSection "Password and account" "Passwords stay in a private browser form. A successful password change does not automatically sign this connection in again."
                                    [ ( "account-password", "account-password", "Change password" ), ( "account-drop", "account-drop", "Delete this account" ) ]
                              else
                                passwordSection model
                            , recoverySection model
                            , if model.runtimeOwnerStamp /= Nothing then
                                privatePasskeySection model
                              else
                                passkeysSection model
                            , devicesSection model
                            , accountCommunitySection model
                            , sessionSection model
                            , draftRecoverySection model
                            , capsSection model
                            , retentionSection model
                            , dataSection model
                            ]
                , if model.runtimeOwnerStamp /= Nothing then
                    View.Integrations.serviceIntegrationPanel model.serviceIntegrationView model.serviceIntegrationForm

                  else
                    text ""
                ]
            ]


privateAccountNotice : String -> String -> Html Msg
privateAccountNotice title description =
    section [ class "onyx-account-section", attribute "role" "status" ]
        [ h3 [ class "onyx-account-section__title" ] [ text title ]
        , p [ class "onyx-account-hint" ] [ text description ]
        ]


privateAccountStatusView : Model -> Html Msg
privateAccountStatusView model =
    case model.privateAccountStatus of
        Nothing ->
            text ""

        Just status ->
            let
                outcome =
                    case status.outcome of
                        "email-updated" -> "The account email setting was updated. Verify the address separately if the server requires it."
                        "password-changed" -> "The password was changed. Sign in again with the new password when needed."
                        "certificate-password-reset" -> "The password was reset using the verified client certificate."
                        "account-dropped" -> "The server confirmed account deletion. Local encrypted data remains until you clear it."
                        "reset-request-acknowledged" -> "The reset request was acknowledged. The server does not reveal whether that account has a verified email."
                        "password-reset" -> "The password reset completed. Sign in explicitly with the new password."
                        "account-registered" -> "The account was registered. Registration does not prove sign-in or email verification."
                        "email-verified" -> "The account email was verified."
                        "no-pending-verification" -> "There is no pending email verification for this account."
                        _ -> ""

                phase =
                    case status.phase of
                        "pending" -> "Waiting for a matching server response."
                        "unknown" -> "The result is unknown; do not repeat this account operation automatically."
                        "blocked" -> "The account operation could not be sent."
                        "failed" -> "The account operation failed."
                        "accepted" -> outcome
                        _ -> ""
            in
            if String.isEmpty phase then
                text ""
            else
                section [ class "onyx-account-section", attribute "role" "status", attribute "aria-live" "polite" ]
                    [ h3 [ class "onyx-account-section__title" ] [ text "Private account operation" ]
                    , p [ class "onyx-account-hint" ] [ text phase ]
                    , Maybe.withDefault (text "") (Maybe.map (\account -> p [ class "onyx-account-hint" ] [ text ("Account: " ++ account) ]) status.targetAccount)
                    , if status.requiresLogin then p [ class "onyx-account-hint" ] [ text "Sign in is a separate action." ] else text ""
                    , Maybe.withDefault (text "") (Maybe.map (\_ -> p [ class "onyx-account-hint" ] [ text "The private operation could not be completed; review the form and server state before trying again." ]) status.reason)
                    ]


privateManagementSection : String -> String -> List ( String, String, String ) -> Html Msg
privateManagementSection title description forms =
    section [ class "onyx-account-section", attribute "role" "group" ]
        [ h3 [ class "onyx-account-section__title" ] [ text title ]
        , p [ class "onyx-account-hint" ] [ text description ]
        , div [ class "onyx-account-actions" ]
            (List.map
                (\( kind, action, labelText ) ->
                    button
                        [ type_ "button"
                        , onClick (App.RuntimePrivateAccountFormRequested { kind = kind, action = action, account = Nothing })
                        ]
                        [ text labelText ]
                )
                forms
            )
        ]


privatePasskeySection : Model -> Html Msg
privatePasskeySection model =
    section [ class "onyx-account-section", id "acct-passkeys-title" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Passkeys" ]
        , p [ class "onyx-account-hint" ]
            [ text "Passkey challenge and response bytes stay in the private browser runtime. A browser prompt may be denied if transient user activation has expired by the time the server challenge arrives." ]
        , div [ class "onyx-account-actions" ]
            [ button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.WebAuthnBegin "register" model.accountName)) ] [ text "Register a passkey" ]
            , button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.WebAuthnBegin "authenticate" model.accountName)) ] [ text "Sign in with a passkey" ]
            ]
        ]


sectionNav : Html Msg
sectionNav =
    nav [ class "onyx-account-nav", attribute "aria-label" "Account sections" ]
        [ a [ class "onyx-account-nav__item", href "#acct-identity" ] [ text "Overview" ]
        , a [ class "onyx-account-nav__item", href "#acct-two-factor-authentication-title" ] [ text "Security" ]
        , a [ class "onyx-account-nav__item", href "#acct-certificates-title" ] [ text "Certificates" ]
        , a [ class "onyx-account-nav__item", href "#acct-transparency-title" ] [ text "Transparency" ]
        , a [ class "onyx-account-nav__item", href "#acct-device-keys-title" ] [ text "Keys" ]
        , a [ class "onyx-account-nav__item", href "#acct-personas-title" ] [ text "Personas" ]
        , a [ class "onyx-account-nav__item", href "#acct-email-title" ] [ text "Email" ]
        , a [ class "onyx-account-nav__item", href "#acct-password-title" ] [ text "Password" ]
        , a [ class "onyx-account-nav__item", href "#acct-recovery-title" ] [ text "Recovery" ]
        , a [ class "onyx-account-nav__item", href "#acct-passkeys-title" ] [ text "Passkeys" ]
        , a [ class "onyx-account-nav__item", href "#acct-sessions-title" ] [ text "Devices" ]
        , a [ class "onyx-account-nav__item", href "#acct-session-title" ] [ text "Session" ]
        , a [ class "onyx-account-nav__item", href "#acct-caps-title" ] [ text "Capabilities" ]
        , a [ class "onyx-account-nav__item", href "#acct-history-title" ] [ text "History" ]
        , a [ class "onyx-account-nav__item", href "#acct-download-store-title" ] [ text "Data" ]
        ]


overviewSection : Model -> Html Msg
overviewSection model =
    section [ class "onyx-account-section", id "acct-identity" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Overview" ]
         , dl [ class "onyx-account-facts" ]
            ([ fact "Account" (Maybe.withDefault "" model.accountName)
             , fact "Nick" model.ourNick
             ]
                ++ infoFacts model
            )
         ]
            ++ pendingNote model.accountInfoPending "Loading account details…"
            ++ errorNote model
        )


infoFacts : Model -> List (Html Msg)
infoFacts model =
    case model.accountInfo of
        Nothing ->
            []

        Just info ->
            [ fact "Email" (Maybe.withDefault "—" info.email)
            , fact "Registered" (Maybe.withDefault "—" info.registered)
            , fact "Secure" (yesNo info.secure)
            , fact "Enforce" (yesNo info.enforce)
            , fact "Flags" (Maybe.withDefault "—" (Maybe.map String.fromInt info.flags))
            ]


fact : String -> String -> Html Msg
fact label value =
    div [ class "onyx-account-fact" ]
        [ dt [ class "onyx-account-fact__term" ] [ text label ]
        , dd [ class "onyx-account-fact__value" ] [ text value ]
        ]


yesNo : Maybe Bool -> String
yesNo value =
    case value of
        Just True ->
            "Yes"

        Just False ->
            "No"

        Nothing ->
            "—"


pendingNote : Bool -> String -> List (Html Msg)
pendingNote pending copy =
    if pending then
        [ p [ class "onyx-account-pending" ] [ text copy ] ]

    else
        []


errorNote : Model -> List (Html Msg)
errorNote model =
    case model.accountActionError of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error" ] [ text err.description ] ]


devicesSection : Model -> Html Msg
devicesSection model =
    section [ class "onyx-account-section", id "acct-sessions-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Devices" ]
         , p [ class "onyx-account-hint" ] [ text "Signed-in browsers. Dropping one signs it out." ]
         , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-refresh"
                , attribute "data-testid" "account-sessions-refresh"
                , disabled model.accountSessionsPending
                , onClick SessionListRequested
                ]
                [ text "Refresh" ]
            ]
         ]
            ++ pendingNote model.accountSessionsPending "Loading sessions…"
            ++ sessionError model
            ++ [ sessionList model, meshSessionPanel model ]
        )


sessionError : Model -> List (Html Msg)
sessionError model =
    case model.accountSessionsError of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error" ] [ text err ] ]


sessionList : Model -> Html Msg
sessionList model =
    case model.sessionInventoryView of
        Nothing ->
            p [ class "onyx-account-empty" ] [ text "Refresh to load local session attachments." ]

        Just inventory ->
            if inventory.mode /= "local" then
                p [ class "onyx-account-empty" ] [ text "The local session list is not available in this view." ]

            else if List.isEmpty inventory.localRows then
                p [ class "onyx-account-empty", attribute "role" "status" ] [ text (inventoryMessage inventory) ]

            else
                ul [ class "onyx-account-sessions" ]
                    (List.map
                        (\row ->
                            li [ class "onyx-account-session" ]
                                [ span [ class "onyx-account-session__name" ] [ text ("Local session " ++ String.fromInt row.index) ]
                                , span [ class "onyx-account-session__state" ] [ text row.state ]
                                , if row.current then span [ class "onyx-account-session__current" ] [ text "This connection" ]
                                  else button [ type_ "button", class "onyx-account-session__drop", attribute "aria-label" ("Sign out local session " ++ String.fromInt row.index), onClick (SessionDropRequested { index = row.index }) ] [ text "Sign out" ]
                                ]
                        )
                        inventory.localRows
                    )


inventoryMessage : RuntimeDomain.SessionInventoryView -> String
inventoryMessage inventory =
    case inventory.status of
        "pending" -> "Loading session inventory…"
        "partial" -> "The inventory is partial. Refresh before relying on it."
        "stale" -> "This inventory is stale. Refresh to reconcile it."
        "unknown" -> "The inventory result is unknown. Refresh explicitly to check again."
        "unsupported" -> "This server does not provide this session inventory."
        "failed" -> "The session inventory could not be loaded."
        _ -> String.fromInt (List.length inventory.localRows + List.length inventory.meshRows) ++ " rows were returned."


meshSessionPanel : Model -> Html Msg
meshSessionPanel model =
    let
        inventory = model.sessionInventoryView
        revocation = model.sessionRevocationView
        scanRef = Maybe.andThen .scanRef inventory
        canContinue = Maybe.map (\view -> view.mode == "mesh" && view.continuationAvailable && view.scanRef /= Nothing && view.status /= "unknown") inventory == Just True
    in
    section [ class "onyx-account-section", attribute "data-testid" "mesh-session-inventory" ]
        ([ h4 [ class "onyx-account-section__title" ] [ text "Other server attachments" ]
         , p [ class "onyx-account-hint" ] [ text "Mesh attachment groups are server-wide identities. Local session IDs and mesh group references are separate selectors." ]
         , div [ class "onyx-account-actions" ]
            [ button [ type_ "button", disabled (model.runtimeDomainPending /= Nothing), onClick (App.RuntimeDomainActionRequested RuntimeDomain.MeshSessionList) ] [ text "Refresh mesh inventory" ]
            , if canContinue then button [ type_ "button", disabled (model.runtimeDomainPending /= Nothing), onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MeshSessionNext (Maybe.withDefault "" scanRef))) ] [ text "Load next mesh page" ] else text ""
            ]
         ]
            ++ (case inventory of
                    Just view ->
                        if view.mode /= "mesh" then [] else
                            [ p [ attribute "role" "status", attribute "aria-live" "polite" ]
                                [ text (inventoryMessage view ++ " Pages: " ++ String.fromInt view.pageCount ++ ". " ++ (if view.scanComplete then "Scan complete; coverage is reported per group." else "More pages may remain.")) ]
                            , if List.isEmpty view.meshRows then p [ class "onyx-account-empty" ] [ text "No mesh rows are available in this scan." ] else
                                ul [] (List.map meshSessionRow view.meshRows)
                            ]
                    Nothing -> [ p [ class "onyx-account-empty" ] [ text "Mesh inventory has not been requested." ] ]
               )
            ++ (case revocation of
                    Just state ->
                        [ p [ attribute "role" "status", attribute "aria-live" "polite" ] [ text ("Mesh revoke " ++ state.status ++ Maybe.withDefault "" (Maybe.map (\reason -> " (" ++ reason ++ ")") state.reason)) ]
                        , if List.member state.status [ "completion-unknown", "preflight-pending", "local-denial-committed" ] then
                            div [ class "onyx-account-actions" ]
                                [ button [ type_ "button", disabled (model.runtimeDomainPending /= Nothing), onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MeshSessionReconcile state.revokeRef)) ] [ text "Reconcile this revoke" ]
                                , button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MeshSessionDismiss state.revokeRef)) ] [ text "Dismiss unresolved revoke" ]
                                ]
                          else text ""
                        ]
                    Nothing -> []
               )
        )


meshSessionRow : RuntimeDomain.SessionMeshRow -> Html Msg
meshSessionRow row =
    li [ attribute "data-testid" "mesh-session-row" ]
        [ p [] [ text ("Group " ++ row.groupRef ++ " · node " ++ row.nodeHex ++ " · " ++ row.state) ]
        , p [] [ text ("Inventory " ++ row.inventory ++ "; coverage " ++ row.coverage ++ "; observed " ++ row.observedAt) ]
        , case row.attachmentId of
            Just aid -> code [] [ text ("Attachment " ++ aid) ]
            Nothing -> text ""
        , button [ type_ "button", disabled (List.member row.state [ "revoked", "unknown" ]), onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MeshSessionRevoke row.groupRef)) ] [ text "Revoke this group" ]
        ]


accountCommunitySection : Model -> Html Msg
accountCommunitySection model =
    let
        view = model.accountCommunityView
        busy = model.runtimeDomainPending /= Nothing
        inputValue = String.trim model.accountCommunityInput
    in
    section [ class "onyx-account-section", attribute "data-testid" "account-community" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Account lists" ]
        , p [ class "onyx-account-hint" ] [ text "Changes are shown only after a matching server acknowledgement and a fresh authoritative list." ]
        , div [ class "onyx-account-actions" ]
            [ button [ type_ "button", disabled busy, onClick (App.RuntimeDomainActionRequested RuntimeDomain.AutojoinList) ] [ text "Refresh autojoin list" ]
            , button [ type_ "button", disabled busy, onClick (App.RuntimeDomainActionRequested RuntimeDomain.GroupList) ] [ text "Refresh nick groups" ]
            ]
        , label [ for "account-community-input" ] [ text "Channel or nick" ]
        , input [ id "account-community-input", type_ "text", maxlength 128, value model.accountCommunityInput, onInput AccountCommunityInput, attribute "autocomplete" "off" ] []
        , div [ class "onyx-account-actions" ]
            [ button [ type_ "button", disabled (busy || String.isEmpty inputValue), onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AutojoinAdd inputValue)) ] [ text "Add autojoin channel" ]
            , button [ type_ "button", disabled (busy || String.isEmpty inputValue), onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupAdd inputValue)) ] [ text "Add nick group member" ]
            ]
        , case view of
            Nothing -> p [ class "onyx-account-empty" ] [ text "Refresh a list to review the server state." ]
            Just state ->
                div [ attribute "role" "status", attribute "aria-live" "polite" ]
                    ([ p [] [ text (state.section ++ " list: " ++ state.status ++ Maybe.withDefault "" (Maybe.map (\reason -> " (" ++ reason ++ ")") state.reason)) ] ]
                        ++ (if state.section == "autojoin" then
                                [ ul [] (List.map (\channel -> li [] [ text channel, button [ type_ "button", disabled busy, onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AutojoinRemove channel)) ] [ text "Remove" ] ]) state.autojoinRows) ]
                            else
                                [ ul [] (List.map (\member -> li [] [ text (member.nick ++ (if member.primary then " · primary" else "")), if member.primary then text "" else button [ type_ "button", disabled busy, onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupPrimary member.nick)) ] [ text "Make primary" ], button [ type_ "button", disabled busy, onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupRemove member.nick)) ] [ text "Remove" ] ]) state.groupRows) ]
                           )
                    )
        ]


draftRecoverySection : Model -> Html Msg
draftRecoverySection model =
    let
        view = model.draftRecoveryView
        activeTarget = model.activeChannel
    in
    section [ class "onyx-account-section", attribute "data-testid" "draft-recovery" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Recover a saved draft" ]
        , p [ class "onyx-account-hint" ] [ text "Choose an unlocked local workspace first. Recovery only previews text for the matching conversation; it never sends or saves it." ]
        , button [ type_ "button", disabled (model.runtimeDomainPending /= Nothing), onClick (App.RuntimeDomainActionRequested RuntimeDomain.DraftRecoveryList) ] [ text "List saved drafts in the selected workspace" ]
        , case view of
            Nothing -> p [ class "onyx-account-empty" ] [ text "No saved-draft list has been loaded." ]
            Just state ->
                div []
                    ([ p [ attribute "role" "status" ] [ text ("Draft list: " ++ state.status ++ Maybe.withDefault "" (Maybe.map (\reason -> " (" ++ reason ++ ")") state.reason)) ]
                     , if state.truncated then p [ attribute "role" "status" ] [ text "Showing up to 100 drafts; additional drafts remain stored." ] else text ""
                     , ul [] (List.map (\item -> li [] [ text (item.conversationId ++ " · revision " ++ String.fromFloat item.revision ++ " · " ++ String.fromInt item.ciphertextBytes ++ " encrypted bytes"), button [ type_ "button", disabled (model.runtimeDomainPending /= Nothing || activeTarget /= Just item.conversationId), onClick (App.RuntimeDomainActionRequested (RuntimeDomain.DraftRecover item.draftRef)) ] [ text "Preview in this conversation" ] ]) state.items)
                     ]
                        ++ (case model.draftRecoveryPreview of
                                Just preview ->
                                    [ section [ attribute "role" "group", attribute "aria-label" "Recovered draft preview" ]
                                        [ h4 [] [ text "Review recovered draft" ]
                                        , p [] [ text ("Conversation: " ++ preview.conversationId ++ ". Review the text below before replacing the composer.") ]
                                        , pre [] [ text preview.text ]
                                        , button [ type_ "button", onClick DraftRecoveryPreviewInserted ] [ text "Replace composer with this draft" ]
                                        , button [ type_ "button", onClick DraftRecoveryPreviewDismissed ] [ text "Dismiss preview" ]
                                        ]
                                    ]
                                Nothing -> []
                           )
                    )
        ]


sessionRow : Session.AccountSessionRow -> Html Msg
sessionRow row =
    li [ class "onyx-account-session" ]
        [ span [ class "onyx-account-session__name" ]
            [ text ("Session " ++ String.fromInt row.index) ]
        , span [ class "onyx-account-session__state" ]
            [ text
                (case row.state of
                    Attached ->
                        "attached"

                    Detached ->
                        "detached"
                )
            ]
        , if row.current then
            span [ class "onyx-account-session__current" ] [ text "This connection" ]

          else
            button
                [ type_ "button"
                , class "onyx-account-session__drop"
                , attribute "aria-label" ("Sign out session " ++ String.fromInt row.index)
                , onClick (SessionDropRequested { index = row.index })
                ]
                [ text "Sign out" ]
        ]


sessionSection : Model -> Html Msg
sessionSection model =
    section [ class "onyx-account-section", id "acct-session-title" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Session" ]
        , p [ class "onyx-account-hint" ]
            [ text ("Signed in as " ++ Maybe.withDefault "" model.accountName ++ ".") ]
        , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-logout"
                , attribute "data-testid" "account-logout"
                , onClick SessionLogoutRequested
                ]
                [ text "Sign out of this connection" ]
            ]
        , pushRow model
        ]


{-| Session capabilities (mirroring the oracle
`CapabilityMatrixSection`: active means this connection uses it
now; disconnected shows the connect prompt instead). -}
capsSection : Model -> Html Msg
capsSection model =
    let
        rows =
            Session.buildCapabilityMatrix { negotiated = model.caps, available = model.capAvailable }
    in
    section [ class "onyx-account-section", id "acct-caps-title" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Session capabilities" ]
        , p [ class "onyx-account-hint" ]
            [ text "These are browser and server connection capabilities, not native-app features. Active means this connection is using it now." ]
        , p [ class "onyx-account-hint", attribute "data-testid" "capability-matrix-summary", attribute "role" "status" ]
            [ text
                (if model.connection == Live then
                    Session.capabilitySummary rows

                 else
                    "Connect to see what this browser connection supports."
                )
            ]
        , if model.connection == Live then
            ul [ class "onyx-account-caps", attribute "aria-label" "Product capabilities", attribute "data-testid" "capability-matrix-list" ]
                (List.map capRow rows)

          else
            text ""
        ]


capRow : Session.CapRow -> Html Msg
capRow row =
    li [ class "onyx-account-cap", attribute "data-testid" "capability-matrix-row", attribute "data-cap-status" (capStatusLabel row.status) ]
        [ strong [] [ text row.label ]
        , text " · "
        , span [ class "onyx-account-cap-status" ] [ text (capStatusLabel row.status) ]
        , span [ class "onyx-account-hint" ] [ text (" — " ++ row.hint) ]
        ]


retentionSection : Model -> Html Msg
retentionSection model =
    let
        policy =
            model.retentionPolicy

        keepCurrent =
            String.fromInt policy.keep

        ageCurrent =
            case policy.maxAgeDays of
                Nothing ->
                    "none"

                Just days ->
                    let
                        id =
                            String.fromFloat days
                    in
                    if List.member id (List.filterMap (\opt -> Maybe.map String.fromFloat opt) Retention.ageOptions) then
                        id

                    else
                        "none"

    in
    section [ class "onyx-account-section", id "acct-history-title" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "On-device history" ]
        , span [ class "onyx-account-scope" ] [ text "This device" ]
        , p [ class "onyx-account-hint" ]
            [ text "Choose how much recent history this browser keeps for fast opening, offline reading, and device-memory search. Older messages are pruned automatically. Encrypted DM plaintext is never stored." ]
        , p [ class "onyx-account-chips__label", id "acct-history-keep" ] [ text "Messages per conversation" ]
        , p [ class "onyx-account-chips__desc" ] [ text "The newest messages retained for each room or DM on this device." ]
        , div [ class "onyx-account-chips", attribute "role" "radiogroup", attribute "aria-labelledby" "acct-history-keep" ]
            (List.map
                (\keep ->
                    let
                        id =
                            String.fromInt keep

                        isOn =
                            id == keepCurrent
                    in
                    button
                        [ type_ "button"
                        , class ("onyx-account-chip" ++ (if isOn then " on" else ""))
                        , attribute "role" "radio"
                        , attribute "aria-checked"
                            (if isOn then
                                "true"

                             else
                                "false"
                            )
                        , tabindex
                            (if isOn then
                                0

                             else
                                -1
                            )
                        , on "keydown" (retentionRadioKey "keep" keepCurrent (List.map String.fromInt Retention.keepOptions))
                        , onClick (RetentionKeepSelected id)
                        ]
                        [ text (Retention.keepLabels keep) ]
                )
                Retention.keepOptions
            )
        , p [ class "onyx-account-chips__label", id "acct-history-age" ] [ text "Maximum local age" ]
        , p [ class "onyx-account-chips__desc" ] [ text "Also prune messages older than this age, even when the message limit has room." ]
        , div [ class "onyx-account-chips", attribute "role" "radiogroup", attribute "aria-labelledby" "acct-history-age" ]
            (List.map
                (\opt ->
                    let
                        id =
                            case opt of
                                Nothing ->
                                    "none"

                                Just days ->
                                    String.fromFloat days

                        isOn =
                            id == ageCurrent
                    in
                    button
                        [ type_ "button"
                        , class ("onyx-account-chip" ++ (if isOn then " on" else ""))
                        , attribute "role" "radio"
                        , attribute "aria-checked"
                            (if isOn then
                                "true"

                             else
                                "false"
                            )
                        , tabindex
                            (if isOn then
                                0

                             else
                                -1
                            )
                        , on "keydown" (retentionRadioKey "age" ageCurrent retentionAgeIds)
                        , onClick (RetentionAgeSelected id)
                        ]
                        [ text (Retention.ageLabels opt) ]
                )
                Retention.ageOptions
            )
        , p [ class "onyx-account-hint" ]
            [ text "This changes only the private vault in this browser. It does not change server history or a room's EPHEMERAL retention setting." ]
        , case model.retentionStatus of
            Nothing ->
                text ""

            Just status ->
                p [ class "onyx-account-status", attribute "role" "status" ] [ text status ]
        ]


retentionAgeIds : List String
retentionAgeIds =
    "none" :: List.filterMap (\opt -> Maybe.map String.fromFloat opt) Retention.ageOptions


retentionRadioKey : String -> String -> List String -> Decode.Decoder Msg
retentionRadioKey group current ids =
    Decode.field "key" Decode.string
        |> Decode.map (\key -> RetentionRadioKey { group = group, current = current, key = key })


capStatusLabel : Session.CapStatus -> String
capStatusLabel status =
    case status of
        Active ->
            "active"

        Available ->
            "available"

        Missing ->
            "missing"

        Unknown ->
            "unknown"


{-| Closed-tab alerts: the WEBPUSH toggle lives with the session
(mirroring the oracle notification controls — reach this browser
with the tab closed). The toggle probes first; the Elm-side gates
run before any permission prompt. -}
pushRow : Model -> Html Msg
pushRow model =
    div [ class "onyx-account-push" ]
        [ h4 [ class "onyx-account-section__subtitle" ] [ text "Alerts when the tab is closed" ]
        , p [ class "onyx-account-hint", attribute "data-testid" "account-push-status" ]
            [ text (pushStatusCopy model) ]
        , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-push-toggle"
                , attribute "data-testid" "account-push-toggle"
                , disabled model.webPushBusy
                , onClick WebPushToggle
                ]
                [ text
                    (if model.webPushOn then
                        "Turn off push"

                     else
                        "Turn on push"
                    )
                ]
            ]
        ]


pushStatusCopy : Model -> String
pushStatusCopy model =
    if model.webPushBusy && not model.webPushOn then
        "Turning on…"

    else if model.webPushBusy then
        "Turning off…"

    else
        case model.webPushError of
            Just reason ->
                reason

            Nothing ->
                if model.webPushOn then
                    "Push is on for this browser."

                else
                    "Push is off."


securitySection : Model -> Html Msg
securitySection model =
    if model.runtimeOwnerStamp /= Nothing then
        section [ class "onyx-account-section", id "acct-two-factor-authentication-title" ]
            [ h3 [ class "onyx-account-section__title" ] [ text "Two-factor authentication" ]
            , p [ class "onyx-account-hint", attribute "role" "status" ]
                [ text "Authenticator secrets and confirmation codes are handled in the private local-services panel. They are never shown in this account view." ]
            , div [ class "onyx-account-actions" ]
                [ button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "totp-status" Nothing Nothing)) ] [ text "Check authenticator status" ]
                , button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "totp-enroll" Nothing Nothing)) ] [ text "Set up authenticator" ]
                , button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "totp-disable" Nothing Nothing)) ] [ text "Disable authenticator" ]
                ]
            ]

    else
        section [ class "onyx-account-section", id "acct-two-factor-authentication-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Two-factor authentication" ]
         , p [ class "onyx-account-hint" ]
            [ text "A six-digit code from your authenticator app, required at every login." ]
         , p
            [ class "onyx-account-totp-status"
            , attribute "data-status" (totpStatusName model.totp.status)
            ]
            [ text (totpStatusCopy model.totp.status) ]
         ]
            ++ enrollRow model
            ++ secretBlock model
            ++ confirmForm model
            ++ disableRow model
            ++ totpError model
        )


totpStatusName : TotpStatus -> String
totpStatusName status =
    case status of
        TotpUnknown ->
            "unknown"

        TotpDisabled ->
            "disabled"

        TotpPending ->
            "pending"

        TotpActive ->
            "active"


totpStatusCopy : TotpStatus -> String
totpStatusCopy status =
    case status of
        TotpUnknown ->
            "Checking status…"

        TotpDisabled ->
            "Two-factor is off."

        TotpPending ->
            "Enrollment pending — confirm with a code to activate."

        TotpActive ->
            "Two-factor is active on this account."


enrollRow : Model -> List (Html Msg)
enrollRow model =
    case model.totp.status of
        TotpDisabled ->
            [ enrollButton model ]

        TotpUnknown ->
            [ enrollButton model ]

        TotpPending ->
            []

        TotpActive ->
            []


enrollButton : Model -> Html Msg
enrollButton model =
    div [ class "onyx-account-actions" ]
        [ button
            [ type_ "button"
            , class "onyx-account-totp-enroll"
            , attribute "data-testid" "account-totp-enroll"
            , disabled model.totp.busy
            , onClick TotpEnrollRequested
            ]
            [ text
                (if model.totp.busy then
                    "Working…"

                 else
                    "Enable two-factor"
                )
            ]
        ]


secretBlock : Model -> List (Html Msg)
secretBlock model =
    case model.totp.secret of
        Nothing ->
            []

        Just secret ->
            [ div [ class "onyx-account-totp-enroll" ]
                ([ p [ class "onyx-account-hint" ]
                    [ text "Add this secret to your authenticator (or use the otpauth link), then confirm with the current code." ]
                 , div [ class "onyx-account-totp-row" ]
                    ([ code [ class "onyx-account-totp-secret" ] [ text secret ]
                     , button
                        [ type_ "button"
                        , class "onyx-account-totp-copy"
                        , attribute "data-testid" "account-totp-copy-secret"
                        , disabled (model.totpSecretCopy == TotpCopyBusy)
                        , onClick TotpSecretCopyRequested
                        ]
                        [ text (copyLabel model.totpSecretCopy "Copy secret") ]
                     ]
                        ++ otpauthButton model
                    )
                 ]
                    ++ copyFailure model.totpSecretCopy
                    ++ copyFailure model.totpOtpauthCopy
                )
            ]


otpauthButton : Model -> List (Html Msg)
otpauthButton model =
    case model.totp.otpauth of
        Nothing ->
            []

        Just _ ->
            [ button
                [ type_ "button"
                , class "onyx-account-totp-copy"
                , attribute "data-testid" "account-totp-copy-otpauth"
                , disabled (model.totpOtpauthCopy == TotpCopyBusy)
                , onClick TotpOtpauthCopyRequested
                ]
                [ text (copyLabel model.totpOtpauthCopy "Copy otpauth link") ]
            ]


copyLabel : TotpCopy -> String -> String
copyLabel state idle =
    case state of
        TotpCopyIdle ->
            idle

        TotpCopyBusy ->
            "Copying…"

        TotpCopyCopied ->
            "Copied"

        TotpCopyFailed ->
            idle


copyFailure : TotpCopy -> List (Html Msg)
copyFailure state =
    case state of
        TotpCopyFailed ->
            [ p [ class "onyx-account-hint", attribute "role" "alert" ]
                [ text "Clipboard copy failed. Select the authenticator value manually." ]
            ]

        _ ->
            []


confirmForm : Model -> List (Html Msg)
confirmForm model =
    case model.totp.status of
        TotpPending ->
            [ form
                [ class "onyx-account-totp-confirm"
                , onSubmit TotpConfirmSubmitted
                , attribute "aria-label" "Confirm two-factor enrollment"
                ]
                [ label [ class "onyx-account-field-label", for "acct-totp-code" ]
                    [ text "Six-digit code" ]
                , input
                    [ class "onyx-account-field"
                    , id "acct-totp-code"
                    , type_ "text"
                    , value model.totpCodeInput
                    , onInput TotpCodeInput
                    , placeholder "123456"
                    , maxlength totpCodeLength
                    , pattern "[0-9]{6}"
                    , attribute "data-testid" "account-totp-code"
                    ]
                    []
                , button
                    [ type_ "submit"
                    , class "onyx-account-totp-confirm-go"
                    , attribute "data-testid" "account-totp-confirm"
                    , disabled (model.totp.busy || not (isTotpCode model.totpCodeInput))
                    ]
                    [ text "Confirm & activate" ]
                ]
            ]

        _ ->
            []


disableRow : Model -> List (Html Msg)
disableRow model =
    case model.totp.status of
        TotpActive ->
            [ div [ class "onyx-account-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-account-totp-disable"
                    , attribute "data-testid" "account-totp-disable"
                    , disabled model.totp.busy
                    , onClick TotpDisableRequested
                    ]
                    [ text "Disable two-factor" ]
                ]
            ]

        _ ->
            []


totpError : Model -> List (Html Msg)
totpError model =
    case model.totp.error of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error", attribute "role" "alert" ] [ text err ] ]


certSection : Model -> Html Msg
certSection model =
    section [ class "onyx-account-section", id "acct-certificates-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Certificates" ]
         , p [ class "onyx-account-hint" ]
            [ text "Bind this browser's certificate for password-less sign-in." ]
         , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-cert-bind"
                , attribute "data-testid" "account-cert-bind"
                , onClick CertBindRequested
                ]
                [ text "Bind this connection's certificate" ]
            ]
         ]
            ++ certNotices model
            ++ [ form
                    [ class "onyx-account-cert-remove"
                    , onSubmit CertRemoveSubmitted
                    , attribute "aria-label" "Remove certificate fingerprint"
                    ]
                    [ label [ class "onyx-account-field-label", for "acct-cert-fp" ]
                        [ text "Remove a fingerprint" ]
                    , input
                        [ class "onyx-account-field"
                        , id "acct-cert-fp"
                        , type_ "text"
                        , value model.certFingerprint
                        , onInput CertFingerprintInput
                        , placeholder "SHA256:…"
                        , attribute "data-testid" "account-cert-fp"
                        ]
                        []
                    , button
                        [ type_ "submit"
                        , class "onyx-account-cert-remove-go"
                        , attribute "data-testid" "account-cert-remove"
                        , disabled (String.isEmpty (String.trim model.certFingerprint))
                        ]
                        [ text "Remove fingerprint" ]
                    ]
               ]
        )


certNotices : Model -> List (Html Msg)
certNotices model =
    case accountCertNotices model of
        [] ->
            []

        notices ->
            [ ul [ class "onyx-account-cert-list", attribute "aria-label" "Certificate notices" ]
                (List.map (\line -> li [ class "onyx-account-cert-item" ] [ text line ]) notices)
            ]


keytransSection : Model -> Html Msg
keytransSection model =
    section [ class "onyx-account-section", id "acct-transparency-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Transparency" ]
         , p [ class "onyx-account-hint" ]
            [ text "Key transparency root for this account's device keys." ]
         , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-keytrans-refresh"
                , attribute "data-testid" "account-keytrans-refresh"
                , onClick KeytransStatusRequested
                ]
                [ text "Refresh transparency root" ]
            ]
         ]
        )


keytransNotices : Model -> List (Html Msg)
keytransNotices model =
    case accountKeytransNotices model of
        [] ->
            []

        notices ->
            [ ul [ class "onyx-account-cert-list", attribute "aria-label" "Transparency notices" ]
                (List.map (\line -> li [ class "onyx-account-cert-item" ] [ text line ]) notices)
            ]


deviceKeysSection : Model -> Html Msg
deviceKeysSection model =
    section [ class "onyx-account-section", id "acct-device-keys-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Device encryption keys" ]
         , p [ class "onyx-account-hint" ]
            [ text "Publish this browser's public key so other devices on your account can encrypt to you. List entries from every device you use." ]
         , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-device-publish"
                , attribute "data-testid" "account-device-publish"
                , disabled model.e2eePublishBusy
                , onClick E2eeKeyPublishRequested
                ]
                [ text
                    (if model.e2eePublishBusy then
                        "Publishing…"

                     else
                        "Publish this device key"
                    )
                ]
            , button
                [ type_ "button"
                , class "onyx-account-device-list"
                , attribute "data-testid" "account-device-list"
                , onClick E2eeKeyListRequested
                ]
                [ text "List device keys" ]
            , button
                [ type_ "button"
                , class "onyx-account-device-remove-legacy"
                , attribute "data-testid" "account-device-remove-legacy"
                , onClick E2eeKeyDeleteLegacyRequested
                ]
                [ text "Remove legacy browser key" ]
            ]
         , p [ class "onyx-account-hint" ]
            [ text "Older versions published every browser under the shared id “browser”. After publishing this device's stable key, remove that legacy entry if it is still listed." ]
         ]
            ++ keytransNotices model
        )


personasSection : Model -> Html Msg
personasSection model =
    section [ class "onyx-account-section", id "acct-personas-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Personas" ]
         , p [ class "onyx-account-hint" ]
            [ text "Your Guise wardrobe — change the host others see, instantly and mid-session." ]
         ]
            ++ personaRows model
            ++ personaOffers model
        )


personaRows : Model -> List (Html Msg)
personaRows model =
    case model.personas of
        [] ->
            [ p [ class "onyx-account-personas-empty" ]
                [ text "No personas yet — claim one below, or ask staff for a grant." ]
            ]

        personas ->
            [ ul [ class "onyx-account-persona-list", attribute "aria-label" "Your personas" ]
                (List.map personaRow personas)
            , div [ class "onyx-account-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-account-persona-off"
                    , attribute "data-testid" "account-persona-off"
                    , onClick VhostOffRequested
                    ]
                    [ text "Take persona off" ]
                ]
            ]


personaRow : App.Persona -> Html Msg
personaRow persona =
    li [ class "onyx-account-persona-row" ]
        [ div [ class "onyx-account-persona-id" ]
            [ strong [] [ text persona.name ]
            , code [] [ text persona.host ]
            , span [ class "onyx-account-persona-src" ] [ text persona.source ]
            ]
        , button
            [ type_ "button"
            , class "onyx-account-persona-wear"
            , attribute "data-testid" ("account-persona-wear-" ++ persona.name)
            , attribute "aria-label" ("Wear persona " ++ persona.name)
            , onClick (VhostUseRequested persona.name)
            ]
            [ text "Wear" ]
        ]


personaOffers : Model -> List (Html Msg)
personaOffers model =
    case model.personaOffers of
        [] ->
            []

        offers ->
            [ div [ class "onyx-account-persona-offers" ]
                [ p [ class "onyx-account-persona-offers-label" ] [ text "Open offers" ]
                , ul [ attribute "aria-label" "Claimable persona templates" ]
                    (List.map personaOffer offers)
                , form
                    [ class "onyx-account-persona-claim"
                    , onSubmit VhostClaimRequested
                    , attribute "aria-label" "Claim a persona host"
                    , attribute "data-testid" "account-persona-claim-form"
                    ]
                    [ label [ class "onyx-account-field-label", for "acct-persona-host" ]
                        [ text "Claim a host" ]
                    , input
                        [ class "onyx-account-field"
                        , id "acct-persona-host"
                        , type_ "text"
                        , value model.personaClaimHost
                        , onInput PersonaClaimHostInput
                        , placeholder "poets.society/you"
                        , maxlength App.maxPersonaHostLength
                        , attribute "data-testid" "account-persona-host"
                        ]
                        []
                    , button
                        [ type_ "submit"
                        , class "onyx-account-persona-claim-go"
                        , attribute "data-testid" "account-persona-claim"
                        , disabled (String.isEmpty (String.trim model.personaClaimHost))
                        ]
                        [ text "Claim" ]
                    ]
                ]
            ]


personaOffer : App.PersonaOffer -> Html Msg
personaOffer offer =
    li [ class "onyx-account-persona-offer" ]
        ([ code [] [ text offer.template ] ]
            ++ (if String.isEmpty offer.label then
                    []

                else
                    [ span [] [ text offer.label ] ]
               )
        )


emailSection : Model -> Html Msg
emailSection model =
    section [ class "onyx-account-section", id "acct-email-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Email" ]
         , p [ class "onyx-account-hint" ]
            [ text "Used for account recovery. Changing it requires your password." ]
         , form
            [ class "onyx-account-email"
            , onSubmit AccountEmailSubmitted
            , attribute "aria-label" "Change email"
            ]
            [ label [ class "onyx-account-field-label", for "acct-email" ]
                [ text "Email address" ]
            , input
                [ class "onyx-account-field"
                , id "acct-email"
                , type_ "email"
                , value model.accountEmail
                , onInput AccountEmailInput
                , placeholder "you@example.com"
                , attribute "data-testid" "account-email"
                ]
                []
            , label [ class "onyx-account-field-label", for "acct-email-password" ]
                [ text "Current password (to confirm email change)" ]
            , input
                [ class "onyx-account-field"
                , id "acct-email-password"
                , type_ "password"
                , value model.accountEmailPassword
                , onInput AccountEmailPasswordInput
                , placeholder "account password"
                , attribute "data-testid" "account-email-password"
                ]
                []
            , button
                [ type_ "submit"
                , class "onyx-account-email-save"
                , attribute "data-testid" "account-email-save"
                , disabled (String.isEmpty (String.trim model.accountEmail) || String.isEmpty model.accountEmailPassword)
                ]
                [ text "Save email" ]
            ]
         ]
            ++ emailError model
        )


emailError : Model -> List (Html Msg)
emailError model =
    case model.accountEmailError of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error", attribute "role" "alert" ] [ text err ] ]


passwordSection : Model -> Html Msg
passwordSection model =
    section [ class "onyx-account-section", id "acct-password-title" ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Password" ]
         , p [ class "onyx-account-hint" ]
            [ text "Choose a new password. You'll need your current one to confirm." ]
         , form
            [ class "onyx-account-password"
            , onSubmit AccountPasswordSubmitted
            , attribute "aria-label" "Change password"
            ]
            [ label [ class "onyx-account-field-label", for "acct-new-password" ]
                [ text "New password" ]
            , input
                [ class "onyx-account-field"
                , id "acct-new-password"
                , type_ "password"
                , value model.accountNewPassword
                , onInput AccountNewPasswordInput
                , placeholder "new password"
                , attribute "data-testid" "account-new-password"
                ]
                []
            , label [ class "onyx-account-field-label", for "acct-confirm-password" ]
                [ text "Confirm new password" ]
            , input
                [ class "onyx-account-field"
                , id "acct-confirm-password"
                , type_ "password"
                , value model.accountConfirmPassword
                , onInput AccountConfirmPasswordInput
                , placeholder "repeat new password"
                , attribute "data-testid" "account-confirm-password"
                ]
                []
            , label [ class "onyx-account-field-label", for "acct-current-password" ]
                [ text "Current password" ]
            , input
                [ class "onyx-account-field"
                , id "acct-current-password"
                , type_ "password"
                , value model.accountCurrentPassword
                , onInput AccountCurrentPasswordInput
                , placeholder "current password"
                , attribute "data-testid" "account-current-password"
                ]
                []
            , button
                [ type_ "submit"
                , class "onyx-account-password-save"
                , attribute "data-testid" "account-password-save"
                , disabled
                    (String.isEmpty model.accountNewPassword
                        || String.isEmpty model.accountConfirmPassword
                        || String.isEmpty model.accountCurrentPassword
                    )
                ]
                [ text "Change password" ]
            ]
         ]
            ++ passwordError model
        )


passwordError : Model -> List (Html Msg)
passwordError model =
    case model.accountPasswordError of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error", attribute "role" "alert" ] [ text err ] ]


recoverySection : Model -> Html Msg
recoverySection model =
    if model.runtimeOwnerStamp /= Nothing then
        section
            [ class "onyx-account-section"
            , id "acct-recovery-title"
            , attribute "data-testid" "recovery-codes-section"
            ]
            [ h3 [ class "onyx-account-section__title" ] [ text "Recovery codes" ]
            , p [ class "onyx-account-hint", attribute "role" "status" ]
                [ text "Recovery-code status, login, clearing, and one-time display are handled in the private local-services panel. Codes are not retained in this account view." ]
            , div [ class "onyx-account-actions" ]
                [ button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "recovery-status" Nothing Nothing)) ] [ text "Check recovery-code status" ]
                , button [ type_ "button", onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "recovery-generate" Nothing Nothing)) ] [ text "Generate new recovery codes" ]
                , button [ type_ "button", onClick (App.RuntimePrivateAccountFormRequested { kind = "recovery-password", action = "recovery-clear", account = Nothing }) ] [ text "Clear recovery codes" ]
                , button [ type_ "button", onClick (App.RuntimePrivateAccountFormRequested { kind = "recovery-code", action = "recovery-login", account = Nothing }) ] [ text "Sign in with a recovery code" ]
                ]
            ]

    else
        section
        [ class "onyx-account-section"
        , id "acct-recovery-title"
        , attribute "data-testid" "recovery-codes-section"
        ]
        ([ h3 [ class "onyx-account-section__title" ] [ text "Recovery codes" ]
         , p [ class "onyx-account-hint" ]
            [ text "Single-use offline codes for "
            , strong [] [ text (Maybe.withDefault "" model.accountName) ]
            , text " when you lose your password and passkeys. Each code works once; store them somewhere safe offline."
            ]
         , p
            [ class "onyx-account-hint"
            , attribute "role" "status"
            , attribute "data-testid" "recovery-remaining"
            ]
            [ text (recoveryRemainingCopy model.recoveryCodes.remaining) ]
         , label [ class "onyx-account-field-label", for "acct-recovery-password" ]
            [ text "Password (optional re-check)" ]
         , input
            [ class "onyx-account-field"
            , id "acct-recovery-password"
            , type_ "password"
            , value model.recoveryPassword
            , onInput RecoveryCodesPasswordInput
            , disabled model.recoveryCodes.busy
            , attribute "data-testid" "recovery-password"
            ]
            []
         , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "button"
                , class "onyx-account-recovery-generate"
                , attribute "data-testid" "recovery-generate"
                , disabled model.recoveryCodes.busy
                , onClick RecoveryCodesGenerateRequested
                ]
                [ text
                    (if model.recoveryGenerateArmed then
                        "Confirm: replace all codes"

                     else if model.recoveryCodes.busy then
                        "Working…"

                     else
                        "Generate new codes"
                    )
                ]
            , button
                [ type_ "button"
                , class "onyx-account-recovery-refresh"
                , attribute "data-testid" "recovery-refresh"
                , disabled model.recoveryCodes.busy
                , onClick RecoveryCodesStatusRequested
                ]
                [ text "Refresh count" ]
            , button
                [ type_ "button"
                , class "onyx-account-recovery-clear"
                , attribute "data-testid" "recovery-clear"
                , disabled (model.recoveryCodes.busy || model.recoveryCodes.remaining == Just 0)
                , onClick RecoveryCodesClearRequested
                ]
                [ text "Clear all codes" ]
            ]
         ]
            ++ generateArmedNote model
            ++ recoveryError model
            ++ recoveryInfo model
            ++ freshCodesBlock model
        )


recoveryRemainingCopy : Maybe Int -> String
recoveryRemainingCopy remaining =
    case remaining of
        Nothing ->
            "Ask the server how many codes remain…"

        Just 0 ->
            "No unused recovery codes on this account."

        Just 1 ->
            "1 unused recovery code remaining."

        Just n ->
            String.fromInt n ++ " unused recovery codes remaining."


generateArmedNote : Model -> List (Html Msg)
generateArmedNote model =
    if model.recoveryGenerateArmed then
        [ p [ class "onyx-account-hint", attribute "role" "status" ]
            [ text "Generating replaces every existing code. Click again to confirm." ]
        ]

    else
        []


recoveryError : Model -> List (Html Msg)
recoveryError model =
    case model.recoveryCodes.error of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error", attribute "role" "alert", attribute "data-testid" "recovery-error" ]
                [ text err ]
            ]


recoveryInfo : Model -> List (Html Msg)
recoveryInfo model =
    case model.recoveryCodes.info of
        Nothing ->
            []

        Just note ->
            [ p [ class "onyx-account-hint", attribute "role" "status", attribute "data-testid" "recovery-info" ]
                [ text note ]
            ]


freshCodesBlock : Model -> List (Html Msg)
freshCodesBlock model =
    case model.recoveryCodes.freshCodes of
        [] ->
            []

        codes ->
            [ div [ class "onyx-account-recovery-fresh", attribute "data-testid" "recovery-fresh-codes" ]
                [ p [ class "onyx-account-hint" ]
                    [ strong [] [ text "Save these now" ]
                    , text " — they will not be shown again."
                    ]
                , ul [ class "onyx-account-cert-list", attribute "aria-label" "Fresh recovery codes" ]
                    (List.indexedMap
                        (\i fresh ->
                            li [ class "onyx-account-cert-item" ]
                                [ code [ class "onyx-account-totp-secret" ]
                                    [ text (String.fromInt (i + 1) ++ ". " ++ fresh) ]
                                ]
                        )
                        codes
                    )
                , div [ class "onyx-account-actions" ]
                    [ button
                        [ type_ "button"
                        , class "onyx-account-recovery-copy"
                        , attribute "data-testid" "recovery-copy-all"
                        , onClick RecoveryCodesCopyAllRequested
                        ]
                        [ text "Copy all" ]
                    , button
                        [ type_ "button"
                        , class "onyx-account-recovery-done"
                        , attribute "data-testid" "recovery-dismiss-fresh"
                        , onClick RecoveryCodesDismissFresh
                        ]
                        [ text "Done" ]
                    ]
                ]
            ]


passkeysSection : Model -> Html Msg
passkeysSection model =
    section [ class "onyx-account-section", id "acct-passkeys-title" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Passkeys" ]
        , p [ class "onyx-account-hint" ]
            [ text "Sign in without a password using a device passkey — Face ID, a fingerprint, or a security key." ]
        , passkeysBody model
        ]


passkeysBody : Model -> Html Msg
passkeysBody model =
    if model.passkeyBrowserSupported == Just False then
        p [ class "onyx-account-empty", attribute "data-testid" "passkeys-browser-unsupported" ]
            [ text "This browser does not support passkeys. Try a current version of Chrome, Safari, Firefox, or Edge on a device with a screen lock." ]

    else if model.passkey.supported == Just False then
        p [ class "onyx-account-empty", attribute "data-testid" "passkeys-server-unsupported" ]
            [ text "This server does not offer passkey sign-in yet. You can still protect your account with a password and two-factor authentication." ]

    else
        div []
            ([ passkeyRegisterForm model ]
                ++ passkeyNotice model
                ++ passkeyErrorNote model
                ++ [ passkeyListWrap model ]
            )


passkeyRegisterForm : Model -> Html Msg
passkeyRegisterForm model =
    form
        [ class "onyx-account-passkey"
        , onSubmit PasskeyRegisterSubmitted
        , attribute "aria-label" "Add a passkey"
        ]
        [ label [ class "onyx-account-field-label", for "acct-passkey-label" ]
            [ text "Passkey name (optional)" ]
        , input
            [ class "onyx-account-field"
            , id "acct-passkey-label"
            , type_ "text"
            , value model.passkeyLabel
            , onInput PasskeyLabelInput
            , placeholder "e.g. My laptop"
            , maxlength maxLabelLength
            , attribute "data-testid" "account-passkey-label"
            ]
            []
        , button
            [ type_ "submit"
            , class "onyx-account-passkey-add"
            , attribute "data-testid" "account-passkey-add"
            , disabled (model.passkey.busy || Maybe.map (\view -> view.status == "pending") model.passkeyManagementView == Just True)
            ]
            [ text
                (if model.passkey.busy then
                    "Waiting for your device…"

                 else
                    "Add a passkey"
                )
            ]
        ]


passkeyNotice : Model -> List (Html Msg)
passkeyNotice model =
    case model.passkey.notice of
        Nothing ->
            []

        Just note ->
            [ p [ class "onyx-account-passkey-ok", attribute "role" "status" ] [ text note ] ]


passkeyErrorNote : Model -> List (Html Msg)
passkeyErrorNote model =
    case model.passkey.error of
        Nothing ->
            []

        Just err ->
            [ p [ class "onyx-account-error", attribute "role" "alert" ] [ text err ] ]


passkeyListWrap : Model -> Html Msg
passkeyListWrap model =
    let
        listing =
            Maybe.map (\view -> view.status == "pending") model.passkeyManagementView == Just True

        rows =
            model.passkeyManagementView |> Maybe.map .rows |> Maybe.withDefault []

        empty =
            List.isEmpty rows

        statusNote =
            model.passkeyManagementView
                |> Maybe.andThen
                    (\view ->
                        case ( view.status, view.reason ) of
                            ( "unknown", _ ) -> Just "The passkey operation outcome is unknown. Refresh the list before trying again."
                            ( "rejected", Just "not-owned" ) -> Just "That passkey is not available to this account."
                            ( "rejected", Just "not-found" ) -> Just "That passkey could not be found. Refresh the list."
                            ( "rejected", Just "owner-changed" ) -> Just "The account changed before the passkey operation completed. Refresh the list."
                            ( "rejected", _ ) -> Just "The passkey operation could not be completed."
                            _ -> Nothing
                    )
    in
    div [ class "onyx-account-passkey-list" ]
        [ div [ class "onyx-account-actions" ]
            [ h4 [ class "onyx-account-passkey-list-title" ] [ text "Your passkeys" ]
            , button
                [ type_ "button"
                , class "onyx-account-passkey-refresh"
                , attribute "data-testid" "account-passkey-refresh"
                , disabled (listing || model.passkey.busy)
                , onClick PasskeyListRequested
                ]
                [ text
                    (if listing then
                        "Refreshing…"

                     else
                        "Refresh"
                    )
                ]
            ]
        , Maybe.withDefault (text "") (Maybe.map (\note -> p [ class "onyx-account-error", attribute "role" "status" ] [ text note ]) statusNote)
        , if listing && empty then
            p [ class "onyx-account-empty", attribute "data-testid" "passkeys-loading" ]
                [ text "Loading your passkeys…" ]

          else if model.passkeyManagementView /= Nothing && not listing && empty then
            p [ class "onyx-account-empty", attribute "data-testid" "passkeys-empty" ]
                [ text "No passkeys yet. Add one above to sign in without a password." ]

          else if empty then
            text ""

          else
            ul [ class "onyx-account-cert-list", attribute "aria-label" "Your passkeys" ]
                (List.map (passkeyRow model) rows)
        ]


passkeyRow : Model -> RuntimeDomain.PasskeyRow -> Html Msg
passkeyRow model cred =
    li [ class "onyx-account-cert-item", attribute "data-testid" "passkey-row" ]
        [ if model.passkeyRenamingId == Just cred.credentialRef then
            passkeyRenameForm model cred

          else
            div [ class "onyx-account-passkey-row" ]
                [ div [ class "onyx-account-passkey-id" ]
                    [ strong [ class "onyx-account-passkey-name" ]
                        [ text
                            (if String.isEmpty cred.label then
                                "Unnamed passkey"

                             else
                                cred.label
                            )
                        ]
                    , span [ class "onyx-account-passkey-meta" ]
                        [ text (passkeyMeta cred) ]
                    ]
                , div [ class "onyx-account-actions" ]
                    ([ if model.passkey.renameUnsupported then
                        text ""

                       else
                        button
                            [ type_ "button"
                            , class "onyx-account-passkey-rename"
                            , attribute "aria-label" ("Rename " ++ passkeyDisplayName cred)
                            , onClick (PasskeyRenameStarted { id = cred.credentialRef, label = cred.label })
                            ]
                            [ text "Rename" ]
                     ]
                        ++ passkeyRemoveControl model cred
                    )
                ]
        ]


passkeyDisplayName : RuntimeDomain.PasskeyRow -> String
passkeyDisplayName cred =
    if String.isEmpty cred.label then
        "passkey"

    else
        cred.label


passkeyMeta : RuntimeDomain.PasskeyRow -> String
passkeyMeta cred =
    let
        added =
            case String.toFloat cred.createdUnix of
                Nothing ->
                    ""

                Just seconds ->
                    "Added " ++ String.left 10 (millisToIso (seconds * 1000)) ++ " · "
    in
    added ++ "Used " ++ cred.signCount ++ "×"


passkeyRemoveControl : Model -> RuntimeDomain.PasskeyRow -> List (Html Msg)
passkeyRemoveControl model cred =
    if model.passkeyRemoveArmed == Just cred.credentialRef then
        [ span [ class "onyx-account-passkey-confirm", attribute "role" "group", attribute "aria-label" "Confirm removal" ]
            [ button
                [ type_ "button"
                , class "onyx-account-passkey-remove-go"
                , disabled (model.passkey.busy || Maybe.map (\view -> view.status == "pending") model.passkeyManagementView == Just True)
                , onClick PasskeyRemoveConfirmed
                ]
                [ text "Remove?" ]
            , button
                [ type_ "button"
                , class "onyx-account-passkey-cancel"
                , onClick PasskeyRemoveCancelled
                ]
                [ text "Cancel" ]
            ]
        ]

    else
        [ button
            [ type_ "button"
            , class "onyx-account-passkey-remove"
            , attribute "aria-label" ("Remove " ++ passkeyDisplayName cred)
            , onClick (PasskeyRemoveArmed cred.credentialRef)
            ]
            [ text "Remove" ]
        ]


passkeyRenameForm : Model -> RuntimeDomain.PasskeyRow -> Html Msg
passkeyRenameForm model cred =
    form
        [ class "onyx-account-passkey-rename"
        , onSubmit PasskeyRenameSubmitted
        , attribute "aria-label" ("Rename " ++ passkeyDisplayName cred)
        ]
        [ label [ class "onyx-account-field-label", for "acct-passkey-rename" ]
            [ text "New name" ]
        , input
            [ class "onyx-account-field"
            , id "acct-passkey-rename"
            , type_ "text"
            , value model.passkeyRenameValue
            , onInput PasskeyRenameInput
            , maxlength maxLabelLength
            , attribute "data-testid" "account-passkey-rename"
            ]
            []
        , div [ class "onyx-account-actions" ]
            [ button
                [ type_ "submit"
                , class "onyx-account-passkey-save"
                , attribute "data-testid" "account-passkey-save"
                , disabled (model.passkey.busy || String.isEmpty (String.trim model.passkeyRenameValue))
                ]
                [ text "Save" ]
            , button
                [ type_ "button"
                , class "onyx-account-passkey-cancel"
                , onClick PasskeyRenameCancelled
                ]
                [ text "Cancel" ]
            ]
        ]


dataSection : Model -> Html Msg
dataSection model =
    div [ attribute "data-testid" "account-data-verbs" ]
        [ section [ class "onyx-account-section", id "acct-download-store-title" ]
            [ h3 [ class "onyx-account-section__title" ] [ text "Download what we store" ]
            , p [ class "onyx-account-hint" ]
                [ text "Nick, email, and rooms you own. Not the chat. History lives on this device." ]
            , div [ class "onyx-account-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-account-data-download"
                    , attribute "data-testid" "account-download-store"
                    , disabled (model.accountVerbsBusy /= Nothing)
                    , onClick DownloadAccountRecord
                    ]
                    [ text "Download account record" ]
                ]
            ]
        , section [ class "onyx-account-section", id "acct-save-device-history-title" ]
            [ h3 [ class "onyx-account-section__title" ] [ text "Save this device's history" ]
            , p [ class "onyx-account-hint" ]
                [ text "The last ~400 messages per room on this device. You cannot load this back in." ]
            , div [ class "onyx-account-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-account-data-history"
                    , attribute "data-testid" "account-save-device-history"
                    , disabled (model.accountVerbsBusy /= Nothing)
                    , onClick DownloadDeviceHistory
                    ]
                    [ text "Save device history" ]
                ]
            ]
        , section [ class "onyx-account-section", id "acct-delete-account-title" ]
            ([ h3 [ class "onyx-account-section__title" ] [ text "Delete account" ]
             , p [ class "onyx-account-hint" ]
                [ text "This removes your identity. Other people keep their own copies." ]
             , div [ class "onyx-account-actions" ]
                [ button
                    [ type_ "button"
                    , class "onyx-account-drop-arm"
                    , attribute "data-testid" "account-drop-arm"
                    , onClick DropArmed
                    ]
                    [ text "Delete account…" ]
                ]
             ]
                ++ dropConfirmBlock model
            )
        , dataVerbsStatus model
        ]


dataVerbsStatus : Model -> Html Msg
dataVerbsStatus model =
    if String.isEmpty model.accountVerbsStatus then
        text ""

    else
        p [ class "onyx-account-hint", attribute "role" "status", attribute "data-testid" "account-data-verbs-status" ]
            [ text model.accountVerbsStatus ]


dropConfirmBlock : Model -> List (Html Msg)
dropConfirmBlock model =
    if not model.dropArmed then
        []

    else
        [ form
            [ class "onyx-account-drop-confirm"
            , onSubmit DropSubmitted
            , attribute "aria-label" "Confirm account deletion"
            ]
            [ label [ class "onyx-account-field-label", for "acct-drop-confirm" ]
                [ text ("Type \"" ++ Maybe.withDefault "" model.accountName ++ "\" to confirm") ]
            , input
                [ class "onyx-account-field"
                , id "acct-drop-confirm"
                , type_ "text"
                , value model.dropConfirm
                , onInput DropConfirmInput
                , placeholder (Maybe.withDefault "" model.accountName)
                , attribute "data-testid" "account-drop-confirm-input"
                ]
                []
            , label [ class "onyx-account-field-label", for "acct-drop-password" ]
                [ text "Account password" ]
            , input
                [ class "onyx-account-field"
                , id "acct-drop-password"
                , type_ "password"
                , value model.dropPassword
                , onInput DropPasswordInput
                , placeholder "account password"
                , attribute "data-testid" "account-drop-password"
                ]
                []
            , div [ class "onyx-account-actions" ]
                [ button
                    [ type_ "submit"
                    , class "onyx-account-drop-go"
                    , attribute "data-testid" "account-drop-confirm"
                    , disabled (not (dropReady model))
                    ]
                    [ text "Permanently delete" ]
                , button
                    [ type_ "button"
                    , class "onyx-account-drop-cancel"
                    , onClick DropCancelled
                    ]
                    [ text "Cancel" ]
                ]
            ]
        ]
