module View.Topbar exposing (connectionLabel, reclaimDialog, reconnectBanner, topbar)

{-| Shell top bar (global scope) + the reclaim dialog and the
reconnect banner. Room-scoped controls live in `View.RoomHeader`.
-}

import App exposing (Model, Msg(..), isGuestNick)
import Dict
import View.Notify exposing (notifySheetButton)
import View.Switcher exposing (paletteLauncher)
import Html exposing (Html, b, button, div, form, h1, header, input, label, p, span, text)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Nav
import View.ModDesk
import View.Inbox exposing (inbox)
import View.Sheet as Sheet


{-| v3/frame — the GLOBAL bar: brand, the Ctrl/Cmd+K launcher, the
network-scoped entries (Calls, Alerts, the inbox bell, Operator), the
connection pill, the identity chip (You) and Leave. Room-scoped
actions live in `View.RoomHeader` at the top of the conversation
column.
-}
topbar : Model -> Html Msg
topbar model =
    header [ class "onyx-topbar" ]
        ([ div [ class "onyx-brand" ]
            [ span [ class "onyx-gem" ] []
            , h1 [] [ text "Onyx" ]
            ]
         , div [ class "onyx-topbar-search" ] [ paletteLauncher model ]
         , div [ class "onyx-topbar-global" ]
            ([ button
                [ class "onyx-calls-toggle"
                , classList [ ( "onyx-calls-toggle-open", model.callsOpen ) ]
                , onClick ToggleCalls
                ]
                [ text "Calls" ]
             , notifySheetButton model
             , inbox model
             ]
                ++ View.ModDesk.operToggle model
            )
         , div
            [ classList
                [ ( "onyx-conn", True )
                , ( "onyx-conn-live", model.connection == App.Live )
                , ( "onyx-conn-connecting", model.connection == App.Registering )
                ]
            ]
            [ span [ class "onyx-dot" ] []
            , text (connectionLabel model)
            ]
         , identityChip model
         , if model.connection == App.Live || model.autoReconnect then
            button
                [ class "onyx-leave"
                , attribute "aria-label" "Disconnect from Onyx"
                , attribute "data-testid" "session-disconnect"
                , onClick SessionDisconnect
                ]
                [ text "Leave" ]

           else
            text ""
         ]
        )


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
                    ++ [ class "onyx-ident-action"
                       , attribute "aria-label" ("Reclaim the nick " ++ target)
                       , onClick ReclaimOpen
                       ]
                )
                inner

        Nothing ->
            -- v3/nav — the identity chip is the "You" affordance for
            -- everyone (guests and accounts): a pending reclaim wins,
            -- otherwise it opens the You hub.
            button
                (attrs
                    ++ [ class "onyx-ident-you"
                       , attribute "aria-label" "Open You"
                       , attribute "aria-haspopup" "dialog"
                       , attribute "aria-expanded"
                            (if model.youHubOpen then
                                "true"

                             else
                                "false"
                            )
                       , attribute "data-testid" "you-open"
                       , onClick (NavSelect Nav.You)
                       ]
                )
                inner


{-| Nick reclaim dialog, mirroring the connect form's GHOST reclaim:
the account password for the taken name, a gated submit, and cancel.
Rendered in the shell while `reclaimOpen`; the submit reuses the
in-session GHOST+NICK fold (Elm auto-connects, so there is no
pre-connect form to return to). Focus trap and Escape stay ahead.
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
                Sheet.view
                    { scope = "reclaim"
                    , label = Sheet.Labelled ("Reclaim the nick " ++ target)
                    , onClose = ReclaimClose
                    , placement = Sheet.Center
                    , layerClass = "onyx-reclaim-veil"
                    , panelClass = "onyx-reclaim"
                    , backdropClass = ""
                    , layerAttrs = []
                    , modal = True
                    , attrs = []
                    }
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
                                , Sheet.autofocus "reclaim"
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


connectionLabel : Model -> String
connectionLabel model =
    case model.connection of
        App.Offline ->
            "Offline"

        App.Registering ->
            "Connecting"

        App.Live ->
            "Live"
