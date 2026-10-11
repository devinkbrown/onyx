module View.Connect exposing (connectGate)

{-| First-run join screen, mirroring `src/app/Connect.tsx`: one primary
guest path (display name + optional room), with Sign in and Create
account as secondary modes under "Other ways to join".

Copy, labels, aria names, and `data-testid` hooks follow the oracle
(the mode buttons carry its `conn-mode-*` ids). The status line is a
polite live region that distinguishes failure types without naming a
server; its idle copy repeats the lede, so it is visually hidden until
there is news (connecting, an error). Fields lock while a dial is in
flight; Cancel abandons it. A pending deep-link room (`?join=`, an
invite) is named in the guest title and the room hint, since leaving
the room field empty joins it.

v3/rx-public: the gate is a two-part stage — the destination
(`conn-context`: brand, the one `h1`, and for an invite the preview of
who invited you and what the room is about) beside the form card. Phones
stack it; landscape phones and desktops sit them side by side. The card
leads with remembered identities ("Welcome back", metadata only — see
`Remembered`) and the sign-in door offers "Stay signed in". While the
remembered panel shows, its action is the one primary button and the
form submit steps down to a secondary style.

-}

import App exposing (ConnectMode(..), ConnectPhase(..), Model, Msg(..))
import Credentials
import Html exposing (Html, a, aside, button, div, form, h1, h2, input, label, li, main_, nav, p, section, span, text, ul)
import Html.Attributes exposing (attribute, autocomplete, checked, class, classList, disabled, for, href, id, placeholder, type_, value)
import Html.Events exposing (onCheck, onClick, onInput, onSubmit)
import Invite
import Remembered
import View.PublicFrame exposing (brandMark)


connectGate : Model -> Html Msg
connectGate model =
    let
        form_ =
            model.connectForm

        phase =
            App.connectPhase model

        copy =
            App.connectModeCopy form_.mode

        busy =
            phase == ConnectConnecting

        -- A deep link (`?join=`) or invite is already carrying the
        -- room: the guest door names it.
        invitedRoom =
            if String.isEmpty (String.trim form_.room) then
                model.pendingDeepLinkJoin

            else
                Nothing

        title =
            case ( form_.mode, invitedRoom ) of
                ( ConnectGuest, Just room ) ->
                    "Join " ++ room

                _ ->
                    copy.title

        remembered =
            model.rememberedIds

        rememberedShown =
            Remembered.visible { attempted = form_.attempted, registering = form_.mode == ConnectRegister } remembered

        modeKey =
            case form_.mode of
                ConnectGuest ->
                    "guest"

                ConnectSignIn ->
                    "signin"

                ConnectRegister ->
                    "register"
    in
    main_
        [ class "conn"
        , attribute "data-testid" "connect"
        , attribute "data-mode" modeKey
        , attribute "data-invite"
            (if invitedRoom == Nothing then
                "false"

             else
                "true"
            )
        ]
        [ div [ class "conn-stage" ]
            [ context model invitedRoom title copy.body
            , div [ class "conn-card" ]
                ((if rememberedShown then
                    [ rememberedPanel remembered busy ]

                  else
                    []
                 )
                    ++ [ form
                            [ class "conn-form"
                            , attribute "aria-label" "Connect form"
                            , attribute "novalidate" ""
                            , onSubmit ConnectSubmit
                            ]
                            (fields model invitedRoom busy
                                ++ [ div [ class "conn-actions" ]
                                        (button
                                            [ type_ "submit"
                                            , classList [ ( "conn-submit", True ), ( "conn-submit--quiet", rememberedShown ) ]
                                            , disabled (not (App.connectCanSubmit model) || remembered.using /= Nothing)
                                            , attribute "aria-label" (submitAria form_.mode)
                                            , attribute "data-testid" "conn-submit"
                                            ]
                                            [ text (App.connectSubmitLabel form_.mode phase) ]
                                            :: (if busy then
                                                    [ button
                                                        [ type_ "button"
                                                        , class "conn-cancel"
                                                        , onClick ConnectCancel
                                                        , attribute "data-testid" "conn-cancel"
                                                        ]
                                                        [ text "Cancel" ]
                                                    ]

                                                else
                                                    []
                                               )
                                        )
                                   , p
                                        [ classList
                                            [ ( "conn-status", True )
                                            , ( "conn-status-idle", phase == ConnectIdle )
                                            , ( "conn-status-error", phase == ConnectError )
                                            , ( "conn-status-busy", busy )
                                            ]
                                        , attribute "role" "status"
                                        , attribute "aria-live" "polite"
                                        , attribute "data-testid" "conn-status"
                                        ]
                                        [ text (App.connectStatusMessage model) ]
                                   , signInOffer model
                                   ]
                            )
                       , modeNav form_.mode busy
                       ]
                )
            ]
        , nav [ class "conn-foot", attribute "aria-label" "About Onyx" ]
            [ a [ href "/about/" ] [ text "About" ]
            , a [ href "/privacy/" ] [ text "Privacy" ]
            , a [ href "/guidelines/" ] [ text "House rules" ]
            , a [ href "/status/" ] [ text "Status" ]
            ]
        ]


{-| v3/rx-public — "Sign in as X": a guest join that failed on an
account's name (or a name in use) offers the sign-in door for that same
name; signing in takes the name back. -}
signInOffer : Model -> Html Msg
signInOffer model =
    let
        form_ =
            model.connectForm

        nick =
            String.trim form_.nick

        status =
            String.toLower (App.connectStatusMessage model)

        offered =
            form_.mode
                == ConnectGuest
                && App.connectPhase model
                == ConnectError
                && not (String.isEmpty nick)
                && (App.connectShowReclaim model || String.contains "account" status)
    in
    if offered then
        div [ class "conn-offer", attribute "data-testid" "conn-signin-offer" ]
            [ p [ class "conn-offer-text" ] [ text ("If " ++ nick ++ " is your account, sign in to take the name back.") ]
            , button
                [ type_ "button"
                , class "conn-offer-btn"
                , onClick ConnectSignInAs
                , attribute "data-testid" "conn-signin-as"
                ]
                [ text ("Sign in as " ++ nick) ]
            ]

    else
        text ""


{-| The destination: brand, the page's one `h1`, the lede, and — for an
invite (`?join=` plus the share card's `by` / `topic` / `with`) — a
preview of where the link leads. The preview names only what the link
itself carries; it never implies anyone is online.
-}
context : Model -> Maybe String -> String -> String -> Html Msg
context model invitedRoom title body =
    let
        card =
            App.inviteCard model

        -- The share card only describes the room it names.
        sameRoom room =
            Maybe.map String.toLower card.channel == Just (String.toLower room)

        guestInvite =
            model.connectForm.mode == ConnectGuest && invitedRoom /= Nothing

        lede =
            if guestInvite then
                "Choose a display name to walk in."

            else
                body
    in
    aside [ class "conn-context", attribute "aria-label" "Destination" ]
        ([ a [ class "conn-brand", href "/", attribute "aria-label" "Onyx home" ]
            [ brandMark "conn-brand-mark"
            , span [ class "conn-brand-name" ] [ text "Onyx" ]
            ]
         , h1 [ class "conn-title" ] [ text title ]
         , p [ class "conn-body" ] [ text lede ]
         ]
            ++ (case invitedRoom of
                    Just room ->
                        let
                            inviter =
                                if sameRoom room then
                                    card.inviter

                                else
                                    Nothing

                            topic =
                                if sameRoom room then
                                    card.topic

                                else
                                    Nothing

                            faces =
                                if sameRoom room then
                                    card.faces

                                else
                                    []
                        in
                        [ div [ class "conn-invite", attribute "role" "note", attribute "aria-label" "Invite preview", attribute "data-testid" "conn-invite" ]
                            [ span [ class "conn-room-mark", attribute "aria-hidden" "true" ] [ text (String.left 1 room) ]
                            , div [ class "conn-invite-copy" ]
                                ([ p [ class "conn-invite-room" ] [ text room ]
                                 , p [ class "conn-invite-desc" ]
                                    [ text
                                        (case inviter of
                                            Just who ->
                                                Invite.inviteDescription { card | channel = Just room, inviter = Just who, topic = Nothing }

                                            Nothing ->
                                                "You were sent a link to " ++ room ++ " on Onyx."
                                        )
                                    ]
                                 ]
                                    ++ (case topic of
                                            Just t ->
                                                [ p [ class "conn-invite-topic" ] [ text t ] ]

                                            Nothing ->
                                                []
                                       )
                                    ++ (if List.isEmpty faces then
                                            []

                                        else
                                            [ p [ class "conn-invite-faces" ] [ text ("With " ++ String.join ", " faces) ] ]
                                       )
                                )
                            ]
                        , p [ class "conn-context-note" ]
                            [ text "An invite link names a destination. The room still applies its own access rules when you join." ]
                        ]

                    Nothing ->
                        if model.connectForm.mode == ConnectGuest then
                            [ guestPoints ]

                        else
                            []
               )
        )


{-| What the guest door promises (desktop only — CSS hides it on
phones so the form stays high). Facts the product already states on
the landing and privacy pages; nothing about who is online.
-}
guestPoints : Html msg
guestPoints =
    let
        point icon title_ body =
            li [ class "conn-point" ]
                [ span [ class ("conn-point-icon conn-point-icon--" ++ icon), attribute "aria-hidden" "true" ] []
                , span [ class "conn-point-title" ] [ text title_ ]
                , span [ class "conn-point-text" ] [ text body ]
                ]
    in
    ul [ class "conn-points", attribute "aria-label" "Joining as a guest" ]
        [ point "guest" "No account needed" "Pick a display name and you are in."
        , point "claim" "Keep your name later" "Claim it from inside Onyx whenever you want to stay."
        , point "device" "History on this device" "About 400 recent messages per room stay here."
        ]


{-| Remembered identities: secret-free metadata and guarded actions
(Select / Forget per identity, then the selected one's Resume, Sign in,
or Use identity). The selected row is a pressed toggle; the action
names the identity it acts on.
-}
rememberedPanel : Remembered.State -> Bool -> Html Msg
rememberedPanel state busy =
    let
        chosen =
            Remembered.selected state

        locked =
            busy || state.using /= Nothing

        row identity =
            let
                isSelected =
                    state.selectedId == Just identity.id
            in
            li
                [ class "conn-identity"
                , attribute "data-selected"
                    (if isSelected then
                        "true"

                     else
                        "false"
                    )
                , attribute "data-access" (accessKey identity.access)
                ]
                [ button
                    [ type_ "button"
                    , class "conn-identity-select"
                    , attribute "aria-pressed"
                        (if isSelected then
                            "true"

                         else
                            "false"
                        )
                    , attribute "aria-label" ("Select " ++ identity.nick)
                    , disabled locked
                    , onClick (RememberedSelect identity.id)
                    ]
                    [ span [ class "conn-identity-avatar", attribute "aria-hidden" "true" ] [ text (String.toUpper (String.left 1 identity.nick)) ]
                    , span [ class "conn-identity-text" ]
                        [ span [ class "conn-identity-nick" ] [ text identity.nick ]
                        , span [ class "conn-identity-status" ] [ text (Remembered.statusLabel identity.access) ]
                        ]
                    ]
                , button
                    [ type_ "button"
                    , class "conn-identity-forget"
                    , attribute "aria-label" ("Forget " ++ identity.nick)
                    , disabled locked
                    , onClick (RememberedForget identity.id)
                    ]
                    [ text "Forget" ]
                ]
    in
    section [ class "conn-identities", attribute "aria-labelledby" "conn-identities-title", attribute "data-testid" "conn-identities" ]
        [ div [ class "conn-identities-head" ]
            [ p [ class "conn-identities-eyebrow" ] [ text "Welcome back" ]
            , h2 [ id "conn-identities-title", class "conn-identities-title" ] [ text "Continue where you left off" ]
            ]
        , ul [ class "conn-identities-list" ] (List.map row state.identities)
        , div [ class "conn-identities-actions" ]
            [ case chosen of
                Just identity ->
                    button
                        [ type_ "button"
                        , class "conn-identities-go"
                        , disabled locked
                        , attribute "aria-label" (Remembered.actionLabel identity.access ++ " as " ++ identity.nick)
                        , attribute "data-testid" (Remembered.actionTestId identity.access)
                        , onClick RememberedAct
                        ]
                        [ text
                            (if state.using == Just identity.id then
                                "Signing in…"

                             else
                                Remembered.actionLabel identity.access
                            )
                        ]

                Nothing ->
                    text ""
            , button
                [ type_ "button"
                , class "conn-identities-dismiss"
                , attribute "aria-label" "Dismiss remembered identities"
                , onClick RememberedDismiss
                ]
                [ text "Not now" ]
            ]
        , p [ class "conn-identities-or" ] [ text "Or join another way" ]
        ]


accessKey : Credentials.RememberedIdentityAccess -> String
accessKey access =
    case access of
        Credentials.ResumeAccess ->
            "resume"

        Credentials.SignInAccess ->
            "sign-in"

        Credentials.IdentityOnlyAccess ->
            "identity-only"


{-| "Stay signed in": an explicit private-device choice (off by
default), shown on the password sign-in path only. -}
staySignedIn : Model -> Bool -> Html Msg
staySignedIn model busy =
    div [ class "conn-toggle" ]
        [ div [ class "conn-toggle-body" ]
            [ label [ class "conn-toggle-label", for "conn-stay-signed-in" ] [ text "Stay signed in" ]
            , p [ class "conn-toggle-description", id "conn-session-desc" ]
                [ text "Off by default. Saves your account password in this browser. Use only on a private device." ]
            ]
        , input
            [ id "conn-stay-signed-in"
            , type_ "checkbox"
            , class "conn-switch"
            , attribute "role" "switch"
            , attribute "aria-checked"
                (if model.rememberedIds.stay then
                    "true"

                 else
                    "false"
                )
            , attribute "aria-describedby" "conn-session-desc"
            , attribute "data-testid" "conn-stay-signed-in"
            , checked model.rememberedIds.stay
            , disabled busy
            , onCheck ConnectStaySignedIn
            ]
            []
        ]


submitAria : ConnectMode -> String
submitAria mode =
    case mode of
        ConnectGuest ->
            "Join Onyx as a guest"

        ConnectSignIn ->
            "Sign in to Onyx"

        ConnectRegister ->
            "Create your Onyx account"


fields : Model -> Maybe String -> Bool -> List (Html Msg)
fields model invitedRoom busy =
    let
        f =
            model.connectForm

        roomPlaceholder =
            Maybe.withDefault "#lounge" invitedRoom

        nickField =
            field
                { id_ = "conn-nick"
                , label_ = App.connectFieldLabel f.mode
                , kind = "text"
                , placeholder_ = "your-name"
                , auto = "username"
                , value_ = f.nick
                , error = f.nickError
                , hint = Nothing
                , busy = busy
                , onInput_ = ConnectNickInput
                }
    in
    case f.mode of
        ConnectGuest ->
            [ nickField
            , field
                { id_ = "conn-room"
                , label_ = "Room"
                , kind = "text"
                , placeholder_ = roomPlaceholder
                , auto = "off"
                , value_ = f.room
                , error = f.roomError
                , hint =
                    Just
                        (case invitedRoom of
                            Just room ->
                                "Optional — leave empty to join " ++ room ++ "."

                            Nothing ->
                                "Optional — leave empty to land on Home and browse rooms."
                        )
                , busy = busy
                , onInput_ = ConnectRoomInput
                }
            ]

        ConnectSignIn ->
            [ nickField
            , if f.recoveryOpen then
                field
                    { id_ = "conn-recovery"
                    , label_ = "Recovery code"
                    , kind = "text"
                    , placeholder_ = "ABCDE-FGHJK"
                    , auto = "one-time-code"
                    , value_ = f.recoveryCode
                    , error = f.passwordError
                    , hint = Just "Use one of the codes you saved when you set them up."
                    , busy = busy
                    , onInput_ = ConnectRecoveryCodeInput
                    }

              else
                field
                    { id_ = "conn-password"
                    , label_ = "Account password"
                    , kind = "password"
                    , placeholder_ = "your account password"
                    , auto = "current-password"
                    , value_ = f.password
                    , error = f.passwordError
                    , hint = Nothing
                    , busy = busy
                    , onInput_ = ConnectPasswordInput
                    }
            , button
                [ type_ "button"
                , class "conn-link"
                , disabled busy
                , onClick ConnectRecoveryToggle
                , attribute "data-testid" "conn-recovery-toggle"
                ]
                [ text
                    (if f.recoveryOpen then
                        "Use your password instead"

                     else
                        "Use a recovery code"
                    )
                ]
            , field
                { id_ = "conn-room"
                , label_ = "Room"
                , kind = "text"
                , placeholder_ = roomPlaceholder
                , auto = "off"
                , value_ = f.room
                , error = f.roomError
                , hint = Just "Optional."
                , busy = busy
                , onInput_ = ConnectRoomInput
                }
            , if f.recoveryOpen then
                text ""

              else
                staySignedIn model busy
            ]

        ConnectRegister ->
            let
                strength =
                    App.passwordStrength f.password

                -- The submit stays disabled until the form is valid, so
                -- say why as soon as it is knowable: a short password,
                -- or a confirmation that already differs.
                passwordHint =
                    if String.isEmpty f.password then
                        Nothing

                    else
                        App.validateConnectPassword f.password

                confirmError =
                    case f.confirmError of
                        Just err ->
                            Just err

                        Nothing ->
                            if not (String.isEmpty f.confirm) && String.length f.confirm >= String.length f.password then
                                App.validateConnectConfirm f.password f.confirm

                            else
                                Nothing
            in
            [ nickField
            , field
                { id_ = "conn-email"
                , label_ = "Email"
                , kind = "email"
                , placeholder_ = "you@example.com"
                , auto = "email"
                , value_ = f.email
                , error = f.emailError
                , hint = Just "Optional — used for verification and recovery."
                , busy = busy
                , onInput_ = ConnectEmailInput
                }
            , field
                { id_ = "conn-password"
                , label_ = "Password"
                , kind = "password"
                , placeholder_ = "at least 8 characters"
                , auto = "new-password"
                , value_ = f.password
                , error = f.passwordError
                , hint = passwordHint
                , busy = busy
                , onInput_ = ConnectPasswordInput
                }
            , if String.isEmpty f.password then
                text ""

              else
                div
                    [ class "conn-strength"
                    , attribute "data-score" (String.fromInt strength.score)
                    , attribute "aria-label" ("Password strength: " ++ strength.label)
                    ]
                    [ div [ class "conn-strength-bar" ]
                        (List.range 1 4
                            |> List.map
                                (\i ->
                                    span
                                        [ classList [ ( "conn-strength-seg", True ), ( "conn-strength-on", i <= strength.score ) ] ]
                                        []
                                )
                        )
                    , span [ class "conn-strength-label" ] [ text strength.label ]
                    ]
            , field
                { id_ = "conn-confirm"
                , label_ = "Confirm password"
                , kind = "password"
                , placeholder_ = "re-enter your password"
                , auto = "new-password"
                , value_ = f.confirm
                , error = confirmError
                , hint = Nothing
                , busy = busy
                , onInput_ = ConnectConfirmInput
                }
            ]


field :
    { id_ : String
    , label_ : String
    , kind : String
    , placeholder_ : String
    , auto : String
    , value_ : String
    , error : Maybe String
    , hint : Maybe String
    , busy : Bool
    , onInput_ : String -> Msg
    }
    -> Html Msg
field cfg =
    let
        errId =
            cfg.id_ ++ "-error"

        hintId =
            cfg.id_ ++ "-hint"

        describedBy =
            case ( cfg.error, cfg.hint ) of
                ( Just _, _ ) ->
                    [ attribute "aria-describedby" errId, attribute "aria-invalid" "true" ]

                ( Nothing, Just _ ) ->
                    [ attribute "aria-describedby" hintId ]

                _ ->
                    []
    in
    div [ class "conn-field" ]
        [ label [ for cfg.id_, class "conn-label" ] [ text cfg.label_ ]
        , input
            ([ id cfg.id_
             , type_ cfg.kind
             , class "conn-input"
             , placeholder cfg.placeholder_
             , autocomplete (cfg.auto /= "off")
             , attribute "autocomplete" cfg.auto
             , attribute "spellcheck" "false"
             , attribute "autocapitalize" "off"
             , value cfg.value_
             , disabled cfg.busy
             , onInput cfg.onInput_
             ]
                ++ describedBy
            )
            []
        , case cfg.error of
            Just err ->
                p [ id errId, class "conn-error", attribute "role" "alert" ] [ text err ]

            Nothing ->
                case cfg.hint of
                    Just hint ->
                        p [ id hintId, class "conn-hint" ] [ text hint ]

                    Nothing ->
                        text ""
        ]


modeNav : ConnectMode -> Bool -> Html Msg
modeNav current busy =
    let
        entry mode key label_ =
            if mode == current then
                text ""

            else
                button
                    [ type_ "button"
                    , class "conn-alt-btn"
                    , disabled busy
                    , onClick (ConnectModeSet mode)
                    , attribute "data-testid" ("conn-mode-" ++ key)
                    ]
                    [ text label_ ]
    in
    nav [ class "conn-alt", attribute "aria-label" "Other ways to join", attribute "data-testid" "conn-modes" ]
        [ h2 [ class "conn-alt-title" ] [ text "Other ways to join" ]
        , div [ class "conn-alt-row" ]
            [ entry ConnectGuest "guest" "Join as a guest"
            , entry ConnectSignIn "signin" "Sign in"
            , entry ConnectRegister "register" "Create account"
            ]
        ]
