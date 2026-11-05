module View.Topbar exposing (connectionLabel, reclaimDialog, reconnectBanner, sessionRecoveryBanner, topbar)

{-| Shell top bar: brand mark, active-channel topic, connection pill.
-}

import App exposing (Model, Msg(..), isGuestNick)
import Dict
import Html exposing (Html, b, button, div, form, h1, header, input, label, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import View.Inbox exposing (inbox)
import Session
import RuntimeDomain


topbar : Model -> Html Msg
topbar model =
    header [ class "onyx-topbar" ]
        [ div [ class "onyx-brand" ]
            [ span [ class "onyx-gem" ] []
            , h1 [] [ text "Onyx" ]
            ]
        , div [ class "onyx-topic" ] [ text (activeTopic model) ]
        , clientTools model
        , button
            [ type_ "button"
            , attribute "aria-label" ("Connect. " ++ connectionLabel model)
            , attribute "aria-haspopup" "dialog"
            , attribute "data-testid" "connection-open"
            , onClick ConnectionDialogOpen
            , classList
                [ ( "onyx-conn", True )
                , ( "onyx-conn-live", model.connection == App.Live )
                , ( "onyx-conn-connecting", model.connection == App.Registering )
                ]
            ]
            [ span [ class "onyx-dot" ] []
            , span [ class "onyx-conn-name" ] [ text "Connect" ]
            , span [ class "onyx-conn-state" ] [ text (connectionLabel model) ]
            ]
        , identityChip model
        ]


clientTools : Model -> Html Msg
clientTools model =
    div [ class "onyx-topbar-tools", attribute "role" "group", attribute "aria-label" "Conversation tools" ]
        [ clientPanelToggle "Rooms" "client-rooms" model.clientRoomsOpen ToggleClientRooms
        , clientPanelToggle "Members" "client-members" model.clientMembersOpen ToggleClientMembers
        , button
            [ class "onyx-calls-toggle"
            , classList [ ( "onyx-calls-toggle-open", model.callsOpen ) ]
            , onClick ToggleCalls
            ]
            [ text "Calls" ]
        , button
            [ class "onyx-search-toggle"
            , classList [ ( "onyx-search-toggle-open", model.searchOpen ) ]
            , attribute "aria-pressed"
                (if model.searchOpen then
                    "true"

                 else
                    "false"
                )
            , disabled (model.activeChannel == Nothing)
            , onClick SearchOpen
            ]
            [ text "Search" ]
        , pinsToggle model
        , mediaToggle model
        , inbox model
        ]


clientPanelToggle : String -> String -> Bool -> Msg -> Html Msg
clientPanelToggle label panelId open message =
    button
        [ class "onyx-client-panel-toggle"
        , type_ "button"
        , attribute "aria-controls" panelId
        , attribute "aria-expanded" (if open then "true" else "false")
        , onClick message
        ]
        [ text label ]


{-| Pinned-messages toggle (the ribbon overflow entry in the
oracle: channel-gated, labeled with the live pin count). -}
pinsToggle : Model -> Html Msg
pinsToggle model =
    let
        count =
            case model.activeChannel of
                Nothing ->
                    0

                Just channel ->
                    List.length (App.channelPins model channel)

        label =
            if count > 0 then
                String.fromInt count ++ " pinned message" ++ (if count == 1 then "" else "s")

            else
                "Pinned messages"
    in
    button
        [ class "onyx-pins-toggle"
        , classList [ ( "onyx-pins-toggle-open", model.showPinnedMessages ) ]
        , attribute "aria-pressed"
            (if model.showPinnedMessages then
                "true"

             else
                "false"
            )
        , attribute "aria-label" label
        , attribute "data-testid" "ribbon-pins"
        , disabled (model.activeChannel == Nothing)
        , onClick PinnedMessagesOpen
        ]
        [ text "Pins" ]


{-| Conversation-media toggle (the ribbon overflow entry in the
oracle: channel-gated, labelled for the active conversation). -}
mediaToggle : Model -> Html Msg
mediaToggle model =
    let
        label =
            case model.activeChannel of
                Nothing ->
                    "Pictures, files, and links"

                Just channel ->
                    "Pictures, files, and links for " ++ channel
    in
    button
        [ class "onyx-media-toggle"
        , classList [ ( "onyx-media-toggle-open", model.mediaIndexOpen ) ]
        , attribute "aria-pressed"
            (if model.mediaIndexOpen then
                "true"

             else
                "false"
            )
        , attribute "aria-label" label
        , attribute "data-testid" "ribbon-room-media"
        , disabled (model.activeChannel == Nothing)
        , onClick MediaIndexOpen
        ]
        [ text "Media" ]


{-| Own identity chip: the current nick, an `alias` badge while the
nick differs from the authenticated account (or nick ENFORCEMENT
parked us on a guest nick), and a warning state explaining a forced
guest rename. While a reclaim target exists the chip is a button that
opens the reclaim dialog.
-}
identityChip : Model -> Html Msg
identityChip model =
    let
        guest =
            isGuestNick model.ourNick

        inner =
            [ span [ class "onyx-ident-nick" ] [ text model.ourNick ]
            , if model.currentNickIsAlias then
                span [ class "onyx-ident-badge" ] [ text "alias" ]

              else
                text ""
            ]

        attrs =
            [ classList
                [ ( "onyx-ident", True )
                , ( "onyx-ident-action", True )
                , ( "onyx-ident-alias", model.currentNickIsAlias )
                , ( "onyx-ident-guest", guest )
                ]
            , attribute "title" (identityTitle model guest)
            ]
    in
    case App.reclaimTarget model of
        Just target ->
            button
                (attrs
                    ++ [ type_ "button"
                       , attribute "aria-label" ("Reclaim the nick " ++ target)
                       , onClick ReclaimOpen
                       ]
                )
                inner

        Nothing ->
            -- The identity chip is the "You" affordance: a pending
            -- reclaim wins, otherwise a signed-in nick opens Account.
            case model.accountName of
                Just _ ->
                    button
                        (attrs
                            ++ [ type_ "button"
                               , attribute "aria-label" "Open account settings"
                               , attribute "data-testid" "account-open"
                               , onClick (SetAccountOpen True)
                               ]
                        )
                        inner

                Nothing ->
                    button
                        (attrs ++ [ type_ "button", attribute "aria-label" "Choose your chat name or sign in", onClick ConnectionDialogOpen ])
                        inner


{-| Nick reclaim dialog, mirroring the connect form's GHOST reclaim:
the account password for the taken name, a gated submit, and cancel.
Rendered in the shell while `reclaimOpen`; the submit reuses the
in-session GHOST+NICK fold (Elm auto-connects, so there is no
pre-connect form to return to). Focus trap and Escape are a ports/DOM
boundary, the same light-dismiss limit as the other dialogs.
-}
reclaimDialog : Model -> Html Msg
reclaimDialog model =
    if not model.reclaimOpen then
        text ""

    else
        case App.reclaimTarget model of
            Nothing ->
                text ""

            Just target ->
                div [ class "onyx-reclaim-veil" ]
                    [ div
                        [ class "onyx-reclaim"
                        , attribute "role" "dialog"
                        , attribute "aria-label" ("Reclaim the nick " ++ target)
                        ]
                        [ p [ class "onyx-reclaim-lead" ]
                            [ text "Enter the account password for "
                            , b [] [ text target ]
                            , text " to take this name back."
                            ]
                        , form [ onSubmit ReclaimSubmit ]
                            [ label [ class "onyx-reclaim-label", for "onyx-reclaim-password" ]
                                [ text "Account password" ]
                            , input
                                [ type_ "password"
                                , id "onyx-reclaim-password"
                                , placeholder "account password"
                                , attribute "autocomplete" "current-password"
                                , value model.reclaimPassword
                                , onInput ReclaimPasswordInput
                                ]
                                []
                            , div [ class "onyx-reclaim-actions" ]
                                [ button
                                    [ type_ "submit"
                                    , class "onyx-reclaim-submit"
                                    , disabled (String.isEmpty (String.trim model.reclaimPassword))
                                    ]
                                    [ text "Reclaim & take name" ]
                                , button
                                    [ type_ "button"
                                    , class "onyx-reclaim-cancel"
                                    , onClick ReclaimClose
                                    ]
                                    [ text "Cancel" ]
                                ]
                            ]
                        ]
                    ]


identityTitle : Model -> Bool -> String
identityTitle model guest =
    if guest then
        "The server moved you to " ++ model.ourNick ++ ": your nick is protected — sign in to reclaim it."

    else if model.currentNickIsAlias then
        "This nick differs from your account nick."

    else
        "Signed in as " ++ model.ourNick ++ "."


{-| Recovery banner strip, mirroring the oracle `ReconnectStatusBanner`:
phase copy from `App.reconnectBanner`, a Try-again button on the
offline phases (wired to `ReconnectNow`), and a calm live region that
announces only the phase title — the retry seconds churn outside it.
-}
reconnectBanner : Model -> Html Msg
reconnectBanner model =
    case App.reconnectBanner model of
        Nothing ->
            text ""

        Just banner ->
            div
                [ classList
                    [ ( "onyx-reconnect", True )
                    , ( "onyx-reconnect-online", banner.online )
                    ]
                , attribute "role" "region"
                , attribute "aria-label" "Connection recovery"
                ]
                [ span [ class "onyx-reconnect-dot", attribute "aria-hidden" "true" ] []
                , span [ class "onyx-reconnect-msg" ]
                    [ text
                        (if String.isEmpty banner.detail then
                            banner.title

                         else
                            banner.detail
                        )
                    ]
                , if banner.online then
                    text ""

                  else
                    button
                        [ class "onyx-reconnect-retry"
                        , onClick ReconnectNow
                        ]
                        [ text "Try again now" ]
                , span
                    [ class "sr-only"
                    , attribute "role" "status"
                    , attribute "aria-live" "polite"
                    , attribute "aria-atomic" "true"
                    ]
                    [ text banner.title ]
                ]


sessionRecoveryBanner : Model -> Html Msg
sessionRecoveryBanner model =
    case model.sessionReclaim of
        Nothing ->
            if not (List.isEmpty model.sessionTokens.credentials) then
                div [ class "onyx-session-recovery", attribute "role" "group", attribute "aria-label" "Session attachments" ]
                    (credentialStatus model ++ rememberControl model)

            else if model.sessionCredentialIssuance == Session.CredentialPending then
                div [ class "onyx-session-recovery", attribute "role" "status", attribute "aria-live" "polite" ] [ text "Waiting for the server to confirm a new session credential." ]

            else if model.sessionCredentialIssuance == Session.CredentialUnknown then
                div [ class "onyx-session-recovery", attribute "role" "status" ] [ text "The new session credential outcome is unknown; the previous credential was retained." ]

            else if model.connection == App.Live && model.accountName /= Nothing && not model.sessionTokenIssuanceRequested then
                div [ class "onyx-session-recovery", attribute "role" "group", attribute "aria-label" "Session attachments" ]
                    [ span [] [ text "This sign-in has no saved attachment to restore." ]
                    , button [ type_ "button", onClick SessionNewAttachmentRequested ] [ text "Create a new attachment" ]
                    ]

            else
                text ""

        Just notice ->
            let
                status =
                    case ( notice.phase, notice.outcome ) of
                        ( App.Restoring, _ ) -> "Checking the saved session attachment with the server."
                        ( App.Reclaimed, Session.ExactRestored ) -> "The exact saved session attachment was restored."
                        ( App.Reclaimed, Session.NewLegacyAttachment ) -> "The server attached a new session from legacy session state."
                        ( App.Reclaimed, Session.LogicalRestored ) -> "The server restored the logical session."
                        ( App.Reclaimed, _ ) -> "The server confirmed a session attachment."
                        ( App.ReclaimFailed, Session.AttachmentBusy ) -> "This exact attachment is active in another connection. The saved credential is retained."
                        ( App.ReclaimFailed, Session.MissingAttachment ) -> "The saved attachment is unavailable. No fallback attachment was attempted."
                        ( App.ReclaimFailed, Session.ResumeRetryable ) -> "Session restore is temporarily unavailable. The saved credential is retained."
                        ( App.ReclaimFailed, Session.ResumeRevoked ) -> "The server revoked this session credential."
                        ( App.ReclaimFailed, _ ) -> "The server rejected this session credential."
                        ( App.SignInAgain, _ ) -> "The saved session credential expired. Sign in again to continue."
            in
            div [ class "onyx-session-recovery", attribute "role" "status", attribute "aria-live" "polite" ]
                ([ span [] [ text status ] ]
                ++ (if List.isEmpty model.sessionTokens.credentials then [] else rememberControl model)
                ++ [ if notice.phase == App.ReclaimFailed && List.member notice.outcome [ Session.AttachmentBusy, Session.ResumeRetryable ] && notice.credentialRef /= Nothing then
                    button [ type_ "button", onClick SessionRetryRequested ] [ text "Retry this attachment" ]

                  else if notice.phase == App.Reclaimed then
                    button [ type_ "button", onClick SessionNewAttachmentRequested, disabled model.sessionTokenIssuanceRequested ] [ text "Create a new attachment" ]

                  else if notice.phase == App.ReclaimFailed || notice.phase == App.SignInAgain then
                    button [ type_ "button", onClick SessionNewAttachmentRequested, disabled (model.sessionTokenIssuanceRequested || model.accountName == Nothing) ] [ text "Create a new attachment" ]

                  else
                    text ""
                ])


credentialStatus : Model -> List (Html Msg)
credentialStatus model =
    [ span []
        [ text
            (case model.sessionCredentialIssuance of
                Session.CredentialPending -> "Waiting for the server to confirm a new session credential."
                Session.CredentialUnknown -> "The latest credential issuance outcome is unknown; saved credentials were preserved."
                Session.CredentialIdle -> "A session credential is available for this account."
            )
        ]
    ]


rememberControl : Model -> List (Html Msg)
rememberControl model =
    if model.accountName == Nothing then
        []

    else
        [ button
            [ type_ "button"
            , disabled (model.sessionCredentialIssuance == Session.CredentialPending)
            , onClick (App.RuntimeDomainActionRequested (RuntimeDomain.RememberSession (not model.sessionCredentialsRemembered)))
            ]
            [ text (if model.sessionCredentialsRemembered then "Stop remembering on this device" else "Remember this session on this device") ]
        ]
connectionLabel : Model -> String
connectionLabel model =
    case model.connection of
        App.Offline ->
            "Offline"

        App.Registering ->
            "Connecting"

        App.Live ->
            "Live"


activeTopic : Model -> String
activeTopic model =
    case model.activeChannel of
        Nothing ->
            "No channel selected"

        Just name ->
            case Dict.get (String.toLower name) model.channels of
                Nothing ->
                    name

                Just channel ->
                    if String.isEmpty channel.topic then
                        channel.name ++ " — no topic set"

                    else
                        channel.name ++ " — " ++ channel.topic
