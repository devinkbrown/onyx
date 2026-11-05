module View.RuntimeServices exposing (view)

import App exposing (Msg)
import Html exposing (Html, button, div, h2, input, label, li, node, p, section, text, ul)
import Html.Attributes exposing (class, maxlength, placeholder, type_, value)
import Html.Events exposing (onClick, onInput)
import RuntimeDomain


view : Maybe RuntimeDomain.ResultView -> Maybe RuntimeDomain.SessionRecoveryView -> Maybe RuntimeDomain.WebAuthnView -> Maybe { action : String, phase : String, outcome : String, reason : Maybe String, targetAccount : Maybe String, requiresLogin : Bool } -> Bool -> Maybe String -> String -> Int -> Maybe String -> Maybe String -> String -> Bool -> Bool -> Bool -> Bool -> Html Msg
view result recoveryView webAuthnView accountStatus busy activeTarget draftText draftRevision accountName configuredNetwork backupRoomInput accountProven mediaActive muted deafened =
    node "details" [ class "runtime-services-disclosure" ]
        [ node "summary" [ Html.Attributes.attribute "aria-label" "Local services and recovery" ] [ text "Local services and recovery" ]
        , section [ class "runtime-services", Html.Attributes.attribute "aria-label" "Local service controls" ]
        [ h2 [] [ text "Local services" ]
        , p [] [ text "Inspect attachment, message delivery, update, and notification state. Results are scoped to this connection." ]
        , accountStatusView accountStatus
        , sessionRecoveryStatus recoveryView
        , webAuthnStatus webAuthnView
        , div [ class "runtime-services-actions" ]
            [ button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.ListSessionIntents), Html.Attributes.disabled busy ] [ text "List saved attachments" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.ListContinuations), Html.Attributes.disabled busy ] [ text "List account sign-in continuations" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "totp-status" Nothing Nothing)), Html.Attributes.disabled busy ] [ text "Check authenticator status" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "totp-enroll" Nothing Nothing)), Html.Attributes.disabled busy ] [ text "Set up an authenticator" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "totp-disable" Nothing Nothing)), Html.Attributes.disabled busy ] [ text "Disable authenticator" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "recovery-status" Nothing Nothing)), Html.Attributes.disabled busy ] [ text "Check recovery-code status" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityBegin "recovery-generate" Nothing Nothing)), Html.Attributes.disabled busy ] [ text "Generate recovery codes" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.WebAuthnBegin "register" accountName)), Html.Attributes.disabled (busy || not accountProven) ] [ text "Register a passkey in this browser" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.WebAuthnBegin "authenticate" accountName)), Html.Attributes.disabled (busy || accountName == Nothing) ] [ text "Sign in with a passkey" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.NewSessionAttachment), Html.Attributes.disabled busy ] [ text "Start a fresh attachment" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.NewTabIntent), Html.Attributes.disabled busy ] [ text "Create a separate attachment intent for this tab" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberSession True)), Html.Attributes.disabled busy ] [ text "Remember future attachment credentials on this device" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberSession False)), Html.Attributes.disabled busy ] [ text "Stop remembering future attachment credentials" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.ListWorkspaces), Html.Attributes.disabled busy ] [ text "List remembered local workspaces" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberWorkspace True)), Html.Attributes.disabled (busy || not accountProven) ] [ text "Remember this proven account for local offline access" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberWorkspace False)), Html.Attributes.disabled busy ] [ text "Stop remembering future workspaces" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.LockWorkspace), Html.Attributes.disabled busy ] [ text "Lock this local workspace" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.ListJournal), Html.Attributes.disabled busy ] [ text "Review queued messages" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.SaveDraft (Maybe.withDefault "" activeTarget) draftText draftRevision)), Html.Attributes.disabled (busy || activeTarget == Nothing || String.isEmpty draftText) ] [ text "Save this draft on this device" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.QueueMessage (Maybe.withDefault "" activeTarget) "chat" draftText Nothing "message" Nothing)), Html.Attributes.disabled (busy || activeTarget == Nothing || String.isEmpty draftText) ] [ text "Queue as ordinary chat" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.RegisterWorker), Html.Attributes.disabled busy ] [ text "Check for updates" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.InspectPush), Html.Attributes.disabled busy ] [ text "Check notifications" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.PushReconcile), Html.Attributes.disabled busy ] [ text "Reconcile notification registration" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.PushDisable), Html.Attributes.disabled busy ] [ text "Disable notifications" ]
            , if mediaActive then
                button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MediaLeave activeTarget)), Html.Attributes.disabled busy ] [ text "Leave voice or video" ]
              else
                text ""
            , if mediaActive then
                button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MediaMute (not muted))), Html.Attributes.disabled busy ] [ text (if muted then "Unmute microphone" else "Mute microphone") ]
              else
                text ""
            , if mediaActive then
                button [ onClick App.CallToggleDeafen, Html.Attributes.disabled busy ] [ text (if deafened then "Undeafen audio" else "Deafen audio") ]
              else
                text ""
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupDirectoryRefresh (Maybe.withDefault "" activeTarget))), Html.Attributes.disabled (busy || activeTarget == Nothing) ] [ text "Refresh trusted-device directory" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupEnroll (Maybe.withDefault "" activeTarget))), Html.Attributes.disabled (busy || activeTarget == Nothing || not accountProven) ] [ text "Enroll this device for room encryption" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupBootstrapPreview (Maybe.withDefault "" activeTarget))), Html.Attributes.disabled (busy || activeTarget == Nothing || not accountProven) ] [ text "Review a new room encryption checkpoint" ]
            , p [] [ text ("Encrypted backup destination network: " ++ Maybe.withDefault "unavailable" configuredNetwork ++ ". Import adds an explicitly approved history checkpoint; it does not join a room or enable sending.") ]
            , label []
                [ text "Public room name in the backup"
                , input
                    [ type_ "text"
                    , value backupRoomInput
                    , placeholder (Maybe.withDefault "#room-name" activeTarget)
                    , maxlength 512
                    , onInput App.GroupBackupRoomInputChanged
                    , Html.Attributes.attribute "autocomplete" "off"
                    , Html.Attributes.attribute "spellcheck" "false"
                    ]
                    []
                ]
            , button [ onClick (App.RuntimePrivateFilePickRequested "group-backup-import"), Html.Attributes.disabled (busy || configuredNetwork == Nothing || (activeTarget == Nothing && String.isEmpty (String.trim backupRoomInput))) ] [ text "Choose encrypted room recovery backup" ]
            , button [ onClick (App.RuntimePrivateOutputPickRequested "group-backup-export"), Html.Attributes.disabled (busy || activeTarget == Nothing || not accountProven) ] [ text "Export encrypted room recovery backup" ]
            , button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.ReconnectMedia), Html.Attributes.disabled busy ] [ text "Reconnect to enable voice when available" ]
            , button [ onClick (App.RuntimePrivateFilePickRequested "operator-import"), Html.Attributes.disabled busy ] [ text "Review a private setup or diagnostics file" ]
            , button [ onClick (App.RuntimePrivateFilePickRequested "settings-import"), Html.Attributes.disabled busy ] [ text "Preview settings from a private file" ]
            , button [ onClick (App.RuntimePrivateOutputPickRequested "settings-export"), Html.Attributes.disabled busy ] [ text "Export allowed settings to a private file" ]
            , button [ onClick (App.DraftLoadRequested (Maybe.withDefault "" activeTarget)), Html.Attributes.disabled (busy || activeTarget == Nothing) ] [ text "Load saved draft into this composer" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.DraftDiscard (Maybe.withDefault "" activeTarget) draftRevision)), Html.Attributes.disabled (busy || activeTarget == Nothing) ] [ text "Discard saved draft for this conversation" ]
            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.EvictionPreview (Maybe.withDefault [] (Maybe.map List.singleton activeTarget)))), Html.Attributes.disabled (busy || activeTarget == Nothing) ] [ text "Preview local history cleanup" ]
            , button
                [ Html.Attributes.attribute "type" "button"
                , Html.Attributes.attribute "data-onyx-media-capture" "voice"
                , Html.Attributes.attribute "data-onyx-media-conversation" (Maybe.withDefault "" activeTarget)
                , Html.Attributes.disabled (busy || activeTarget == Nothing)
                ]
                [ text "Join voice in this conversation" ]
            , button
                [ Html.Attributes.attribute "type" "button"
                , Html.Attributes.attribute "data-onyx-media-capture" "video"
                , Html.Attributes.attribute "data-onyx-media-conversation" (Maybe.withDefault "" activeTarget)
                , Html.Attributes.disabled (busy || activeTarget == Nothing)
                ]
                [ text "Join video in this conversation" ]
            , button
                [ Html.Attributes.attribute "type" "button"
                , Html.Attributes.attribute "data-onyx-media-capture" "camera-preview"
                , Html.Attributes.attribute "data-onyx-media-conversation" (Maybe.withDefault "" activeTarget)
                , Html.Attributes.disabled (busy || activeTarget == Nothing)
                ]
                [ text "Preview camera privately" ]
            , button
                [ Html.Attributes.attribute "type" "button"
                , Html.Attributes.attribute "data-onyx-media-capture" "screen"
                , Html.Attributes.attribute "data-onyx-media-conversation" (Maybe.withDefault "" activeTarget)
                , Html.Attributes.disabled (busy || activeTarget == Nothing)
                ]
                [ text "Share screen in this conversation" ]
            ]
        , case result of
            Nothing -> p [ Html.Attributes.attribute "aria-live" "polite" ] [ text (if busy then "Request pending…" else "No local service request is pending.") ]
            Just receipt ->
                div []
                    [ p [ Html.Attributes.attribute "aria-live" "polite" ]
                        [ text (receipt.domain ++ "." ++ receipt.action ++ " — " ++ statusLabel receipt.status ++ " (" ++ receipt.completionScope ++ ")" ++ Maybe.withDefault "" (Maybe.map (\reason -> ": " ++ reason) receipt.reason)) ]
                    , ul [] (List.map (resultItem receipt) receipt.items)
                    ]
        ]
        ]


accountStatusView : Maybe { action : String, phase : String, outcome : String, reason : Maybe String, targetAccount : Maybe String, requiresLogin : Bool } -> Html Msg
accountStatusView maybeStatus =
    case maybeStatus of
        Nothing ->
            text ""

        Just status ->
            let
                summary =
                    case status.outcome of
                        "account-registered" -> "The account was registered. Sign-in and email verification are separate."
                        "email-verified" -> "The account email was verified."
                        "no-pending-verification" -> "There is no pending email verification."
                        "reset-request-acknowledged" -> "The reset request was acknowledged; the server does not reveal whether that account has a verified email."
                        "password-reset" -> "The password reset completed. Sign in explicitly with the new password."
                        "account-dropped" -> "The server confirmed account deletion. Local encrypted data remains until you clear it."
                        "email-updated" -> "The email setting was updated; verify the address separately if required."
                        "password-changed" -> "The password changed. Sign in again with the new password when needed."
                        _ -> ""

                phase =
                    case status.phase of
                        "pending" -> "Waiting for a matching server response."
                        "unknown" -> "The result is unknown; no automatic retry was made."
                        "blocked" -> "The operation could not be sent."
                        "failed" -> "The operation failed."
                        "accepted" -> summary
                        _ -> ""
            in
            if String.isEmpty phase then text "" else
                p [ Html.Attributes.attribute "role" "status", Html.Attributes.attribute "aria-live" "polite" ]
                    [ text phase
                    , Maybe.withDefault (text "") (Maybe.map (\account -> text (" Account: " ++ account ++ ".")) status.targetAccount)
                    , if status.requiresLogin then text " Sign in is a separate action." else text ""
                    ]


webAuthnStatus : Maybe RuntimeDomain.WebAuthnView -> Html Msg
webAuthnStatus maybeView =
    case maybeView of
        Nothing ->
            text ""

        Just ceremony ->
            let
                message =
                    case ceremony.phase of
                        "pending" -> "Waiting for the browser passkey ceremony."
                        "transport-admitted" -> "The passkey response was sent. Account authentication still needs confirmation."
                        "blocked" -> "The passkey ceremony could not continue."
                        "unknown" -> "The passkey response outcome is unknown; it will not be retried automatically."
                        _ -> "Passkey ceremony status is unavailable."
            in
            p [ Html.Attributes.attribute "role" "status", Html.Attributes.attribute "aria-live" "polite" ] [ text message ]


sessionRecoveryStatus : Maybe RuntimeDomain.SessionRecoveryView -> Html Msg
sessionRecoveryStatus maybeView =
    case maybeView of
        Nothing ->
            text ""

        Just recovery ->
            let
                message =
                    case recovery.status of
                        "pending" -> "Waiting for the recovery service."
                        "transport-admitted" -> "Recovery request sent; awaiting the server outcome."
                        "blocked" -> "Recovery could not start. Your credential remains available."
                        "unknown" -> "Recovery outcome is unknown. It will not be retried automatically."
                        "redirecting" -> "The recovery service is changing destination. Sign-in proof will be checked again there."
                        "awaiting-authentication" -> "The destination is ready. Authenticate there to continue recovery."
                        "accepted" -> "The server confirmed the recovery outcome."
                        "rejected" -> "The server did not accept the recovery request."
                        _ -> "Recovery status is unavailable."
            in
            p [ Html.Attributes.attribute "role" "status", Html.Attributes.attribute "aria-live" "polite" ] [ text message ]


resultItem : RuntimeDomain.ResultView -> RuntimeDomain.SafeItem -> Html Msg
resultItem result item =
    li []
        ([ text (item.label ++ " — " ++ item.state ++ " ") ]
            ++ (if result.domain == "session" && item.state == "restorable" then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RetrySession item.ref False)) ] [ text "Restore this saved attachment" ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.ForgetSession item.ref)) ] [ text "Forget this attachment" ]
                    ]
                else if result.domain == "tab-intent" && item.state == "restore-required" then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RestoreSessionIntent item.ref)) ] [ text "Restore this attachment" ] ]
                else if result.domain == "tab-intent" && item.state /= "retired" then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RetireTabIntent item.ref)) ] [ text "Retire this attachment intent" ] ]
                else if result.domain == "continuation" then
                    [ if item.state == "usable" then
                        button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.SelectContinuation item.ref)) ] [ text "Select for the next sign-in" ]
                      else
                        text ""
                    , if getExtra 0 item.extra == "remembered" then
                        button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberContinuation item.ref False)) ] [ text "Stop remembering this continuation" ]
                      else
                        button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberContinuation item.ref True)) ] [ text "Remember this continuation on this device" ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.ForgetContinuation item.ref)) ] [ text "Forget this continuation" ]
                    ]
                else if result.domain == "workspace" && item.state == "locked" then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.SelectWorkspace item.ref)) ] [ text "Open local workspace" ] ]
                else if result.domain == "journal" && (item.state == "delivery-unknown" || item.state == "unknown") then
                    -- No retry here: the runtime refuses to resend an
                    -- unknown-outcome entry (explicit-replacement-required),
                    -- so only the outcome check is offered.
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.ReconcileJournal item.ref)) ] [ text "Check delivery outcome" ]
                    , p [] [ text "The outcome is unknown; resending could duplicate the message, so send a new message if it never arrived." ]
                    ]
                else if result.domain == "journal" && (item.state == "queued" || item.state == "held") then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.CancelJournal item.ref)) ] [ text "Cancel queued message" ] ]
                else if result.domain == "operator-import" && item.state == "preview" then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.OperatorImportDismiss item.ref)) ] [ text "Dismiss private report" ] ]
                else if result.domain == "group" && String.startsWith "portable-backup-preview:" item.state then
                    let
                        fingerprint = String.dropLeft (String.length "portable-backup-preview:") item.state
                    in
                    [ p [] [ text ("Network " ++ getExtra 0 item.extra ++ "; account " ++ getExtra 1 item.extra ++ "; room " ++ getExtra 2 item.extra ++ "; epoch " ++ item.label ++ "; accepted commit " ++ getExtra 3 item.extra) ]
                    , p [] [ text ("Signer account " ++ getExtra 4 item.extra ++ "; fingerprint " ++ fingerprint ++ "; trust category " ++ getExtra 5 item.extra ++ ". The backup password protects file integrity only. Approving trusts this checkpoint for local history; it does not verify earlier history, current membership, or authority to send.") ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupBackupApprove item.ref fingerprint)) ] [ text "Trust this history checkpoint" ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupBackupCancel item.ref)) ] [ text "Cancel checkpoint review" ]
                    ]
                else if result.domain == "settings" && item.state == "settings-preview" then
                    let
                        confirmedOptIns =
                            getExtra 1 item.extra |> String.split "," |> List.filter (not << String.isEmpty)
                    in
                    [ p [] [ text ("Allowed values: " ++ getExtra 0 item.extra) ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.SettingsApply item.ref [])) ] [ text "Apply ordinary settings only" ]
                    , if List.isEmpty confirmedOptIns then
                        text ""
                      else
                        button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.SettingsApply item.ref confirmedOptIns)) ] [ text "Confirm and apply the listed privacy opt-ins" ]
                    ]
                else if result.domain == "operator-import" && item.state == "operator-doctor" then
                    [ p [] [ text ("Read-only preflight. Exporter build " ++ getExtra 0 item.extra ++ "; checks passed " ++ getExtra 1 item.extra ++ ", failed " ++ getExtra 2 item.extra ++ "; service manager " ++ getExtra 3 item.extra ++ ". Readiness remains unknown.") ]
                    , p [] [ text ("Check results: " ++ getExtra 4 item.extra) ]
                    , p [] [ text ("Configured capabilities: " ++ getExtra 5 item.extra) ]
                    , p [] [ text (getExtra 6 item.extra ++ "; " ++ getExtra 7 item.extra ++ "; " ++ getExtra 8 item.extra) ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.OperatorImportDismiss item.ref)) ] [ text "Dismiss private report" ]
                    ]
                else if result.domain == "operator-import" && item.state == "operator-setup" then
                    [ p [] [ text ("Read-only " ++ getExtra 0 item.extra ++ " preview, profile " ++ getExtra 1 item.extra ++ ", network validation " ++ getExtra 2 item.extra ++ ", media " ++ getExtra 3 item.extra ++ ", maximum clients " ++ getExtra 4 item.extra ++ ", TLS port " ++ getExtra 5 item.extra ++ ", service manager " ++ getExtra 6 item.extra ++ ". Readiness remains unknown; this report does not apply settings.") ]
                    , p [] [ text (getExtra 7 item.extra ++ "; " ++ getExtra 8 item.extra ++ "; " ++ getExtra 9 item.extra) ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.OperatorImportDismiss item.ref)) ] [ text "Dismiss private report" ]
                    ]
                else if result.domain == "eviction" && String.startsWith "plan;" item.state then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.EvictionApply item.ref)) ] [ text "Confirm cleanup plan" ] ]
                else if result.domain == "platform" && String.startsWith "worker:waiting" item.state && item.ref /= "" then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.WorkerActivate item.ref)) ] [ text "Activate this update when safe" ] ]
                else if result.domain == "platform" && String.startsWith "push:" item.state then
                    (if String.endsWith "registered" item.state then
                        [ button [ onClick (App.RuntimeDomainActionRequested RuntimeDomain.PushDisable) ] [ text "Disable notifications" ] ]
                     else if item.ref /= "" then
                        [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.PushEnable item.ref)) ] [ text "Enable notifications" ] ]
                     else
                        [])
                else if result.domain == "media" && item.state == "camera-preview" then
                    case item.extra of
                        conversationId :: _ ->
                            [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MediaCameraPublish conversationId item.ref)) ] [ text "Publish this camera preview" ]
                            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MediaPreviewRetire item.ref)) ] [ text "Stop camera preview" ]
                            ]

                        _ -> []
                else if result.domain == "account-security" && String.startsWith "security:" item.state then
                    [ p [ Html.Attributes.attribute "aria-live" "polite" ]
                        [ text
                            (item.label ++ " — " ++ String.dropLeft 9 item.state
                                ++ "; authenticator " ++ getExtra 0 item.extra
                                ++ (if String.isEmpty (getExtra 1 item.extra) then "" else "; remaining recovery codes " ++ getExtra 1 item.extra)
                            )
                        ]
                    ]
                        ++ (if item.label == "totp-enroll" && getExtra 0 item.extra == "pending" then
                                [ button
                                    [ onClick (App.RuntimePrivateAccountFormRequested { kind = "totp-code", action = "totp-confirm", account = Nothing }) ]
                                    [ text "Confirm authenticator with a one-time code" ]
                                ]

                            else if item.label == "recovery-status" then
                                [ button
                                    [ onClick (App.RuntimePrivateAccountFormRequested { kind = "recovery-code", action = "recovery-login", account = Nothing }) ]
                                    [ text "Sign in with a recovery code" ]
                                , button
                                    [ onClick (App.RuntimePrivateAccountFormRequested { kind = "recovery-password", action = "recovery-clear", account = Nothing }) ]
                                    [ text "Clear recovery codes" ]
                                ]

                            else
                                [])
                        ++ (if item.ref == "" then
                                []

                            else
                                [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityPresentation item.ref "present" Nothing)) ] [ text "Show one-time private result" ]
                                ]
                                    ++ (if item.label == "recovery-generate" then
                                            [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityPresentation item.ref "copy" (Just "codes"))) ] [ text "Copy recovery codes" ] ]

                                        else if item.label == "totp-enroll" || item.label == "totp-confirm" then
                                            [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityPresentation item.ref "copy" (Just "secret"))) ] [ text "Copy authenticator secret" ]
                                            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityPresentation item.ref "copy" (Just "uri"))) ] [ text "Copy authenticator setup URI" ]
                                            ]

                                        else
                                            [])
                                    ++ [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.AccountSecurityPresentation item.ref "dismiss" Nothing)) ] [ text "Dismiss private result" ] ]
                           )
                else if result.domain == "media" && item.state == "screen-share" then
                    case item.extra of
                        conversationId :: _ ->
                            [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MediaScreenStop conversationId)) ] [ text "Stop screen share" ] ]

                        _ -> []
                else if result.domain == "media" && String.startsWith "webrtc:" item.state then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.MediaWebRtcStop item.ref)) ] [ text "Stop local WebRTC check" ] ]
                else if result.domain == "storage" && item.state == "export-plan" then
                    [ p [] [ text (getExtra 0 item.extra ++ " selected records; " ++ getExtra 1 item.extra ++ " retained locally.") ]
                    , button [ onClick (App.RuntimeStorageExportPickRequested item.ref) ] [ text "Export selected history to a private file" ]
                    ]
                else if result.domain == "group" && String.startsWith "bootstrap-preview:" item.state then
                    [ p [] [ text ("Checkpoint preview; fingerprint " ++ String.dropLeft 18 item.state ++ ". Earlier history and global uniqueness are not verified.") ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupBootstrapApprove item.ref)) ] [ text "Trust this checkpoint for future messages" ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupBootstrapCancel item.ref)) ] [ text "Cancel checkpoint review" ]
                    ]
                else if result.domain == "group" && item.state == "author-ready" then
                    case item.extra of
                        epoch :: commitHash :: _ ->
                            case String.toInt epoch of
                                Just expectedEpoch ->
                                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupAuthorPlan item.ref expectedEpoch commitHash)) ] [ text "Plan a room key update" ]
                                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupWelcomeRequest item.ref expectedEpoch commitHash)) ] [ text "Request current room-key recovery" ]
                                    ]
                                Nothing -> []
                        _ -> []
                else if result.domain == "group" && item.state == "author-plan" then
                    case item.extra of
                        revision :: _ ->
                            [ p [] [ text "This update changes the room key. The runtime requires a recoverable encrypted backup and current membership confirmation." ]
                            , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupAuthorCommit item.ref revision)) ] [ text "Confirm key update and backup" ]
                            ]
                        _ -> []
                else if result.domain == "group" && item.state == "group-device" then
                    case item.extra of
                        account :: device :: trust :: epoch :: commitHash :: _ ->
                            case String.toInt epoch of
                                Just expectedEpoch ->
                                    [ p [] [ text (deviceTrustLabel trust) ]
                                    , if trust == "untrusted" then
                                        -- Explicit trust only; never automatic. Requires independent security review.
                                        button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupTrustPreview item.ref account device)) ] [ text "Review device fingerprint" ]

                                      else
                                        text ""
                                    , node "details" [ class "runtime-services-device-removal" ]
                                        [ node "summary" [] [ text "Remove this device from the room" ]
                                        , p [] [ text ("This rotates the room key from epoch " ++ epoch ++ " so the device cannot read new messages. It cannot erase what the device already received. You cannot remove the device you are using now.") ]
                                        , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupRemoveDevice item.ref account device expectedEpoch commitHash)) ] [ text "Remove device and rotate room key" ]
                                        ]
                                    ]

                                Nothing -> []
                        _ -> []
                else if result.domain == "group" && String.startsWith "device-trust-preview:" item.state then
                    [ p [] [ text ("Signer key fingerprint " ++ String.dropLeft 21 item.state ++ ". Compare it with the device owner through another channel before trusting. Trusting lets this device receive future room keys.") ]
                    , button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupTrustConfirm item.ref)) ] [ text "Trust this device" ]
                    ]
                else if result.domain == "group" && String.startsWith "operation:" item.state then
                    [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.GroupCancel item.ref)) ] [ text "Cancel pending room operation" ] ]
                else if result.domain == "webauthn" && String.startsWith "webauthn:" item.state then
                    [ p [ Html.Attributes.attribute "role" "status" ]
                        [ text (item.label ++ " — " ++ String.dropLeft 9 item.state ++ (if String.isEmpty (getExtra 0 item.extra) then "" else ": " ++ getExtra 0 item.extra) ++ ". Passkey prompts may require a fresh browser gesture after the server challenge.") ]
                    ]
                        ++ (if item.ref == "" then [] else [ button [ onClick (App.RuntimeDomainActionRequested (RuntimeDomain.WebAuthnCancel item.ref)) ] [ text "Cancel passkey request" ] ])
                else
                    []
               )
        )


getExtra : Int -> List String -> String
getExtra index values =
    values |> List.drop index |> List.head |> Maybe.withDefault "unknown"


statusLabel : RuntimeDomain.Status -> String
statusLabel status =
    case status of
        RuntimeDomain.Pending -> "pending"
        RuntimeDomain.Held -> "held"
        RuntimeDomain.TransportAdmitted -> "transport admitted"
        RuntimeDomain.Accepted -> "accepted"
        RuntimeDomain.Unknown -> "outcome unknown"
        RuntimeDomain.Blocked -> "blocked"
        RuntimeDomain.Failed -> "failed"
        RuntimeDomain.Cancelled -> "cancelled"


deviceTrustLabel : String -> String
deviceTrustLabel trust =
    case trust of
        "trusted" -> "You have verified this device."
        "untrusted" -> "You have not verified this device."
        _ -> "This device's identity is unknown."
