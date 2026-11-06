module View.Topbar exposing (connectionLabel, reclaimDialog, reconnectBanner, sessionRecoveryBanner, topbar)

{-| Shell top bar: brand mark (or, on phones, back control and page
title), the inbox bell, and the connection pill. The conversation
tools and topic moved to the room header (`View.RoomHeader`).
-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, b, button, div, form, h1, header, input, label, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import View.Inbox exposing (inbox)
import Nav
import Session
import RuntimeDomain


topbar : Model -> Html Msg
topbar model =
    header [ class "onyx-topbar" ]
        [ backControl model
        , div [ class "onyx-brand" ]
            [ span [ class "onyx-gem" ] []
            , h1 [] [ text "Onyx" ]
            ]
        , p [ class "onyx-topbar-title", attribute "data-testid" "page-title" ] [ text (pageTitle model) ]
        , div [ class "onyx-topbar-spacer" ] []
        , -- The bell is pinned in the bar (never inside a scrolling tool
          -- row); the conversation tools live in the room header.
          inbox model
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
        ]


{-| A conversation is on screen (not Home, not the calls hub). On
phones the collection page can still cover it; CSS handles that. -}
conversationShown : Model -> Bool
conversationShown model =
    not model.callsOpen && Nav.isCollection model.navSection && model.activeChannel /= Nothing


{-| v3/shell-nav: under 768px a conversation is a page pushed over its
collection; this control pops back to the list. Hidden on wider
screens, where the sidebar is always beside the conversation. -}
backControl : Model -> Html Msg
backControl model =
    if conversationShown model then
        button
            [ type_ "button"
            , class "onyx-back"
            , attribute "data-testid" "room-back"
            , attribute "aria-label" ("Back to " ++ Nav.label model.navSection)
            , onClick NavBack
            ]
            [ span [ class "onyx-back-chevron", attribute "aria-hidden" "true" ] []
            , span [ class "onyx-back-label" ] [ text (Nav.label model.navSection) ]
            ]

    else
        text ""


{-| The phone bar's title: the page you are on. -}
pageTitle : Model -> String
pageTitle model =
    if model.callsOpen then
        "Calls"

    else
        case ( model.navSection, model.clientRoomsOpen, model.activeChannel ) of
            ( Nav.Home, _, _ ) ->
                "Home"

            ( section, False, Just name ) ->
                if Nav.isCollection section then
                    name

                else
                    Nav.label section

            ( section, _, _ ) ->
                Nav.label section



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


