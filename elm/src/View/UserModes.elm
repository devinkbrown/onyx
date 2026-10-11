module View.UserModes exposing
    ( autojoinNavItem
    , autojoinSection
    , badgeCount
    , heldRows
    , lastSeenButton
    , memoSheet
    , offlineBlock
    , offlineLink
    , privacyPanel
    , requestsBlock
    , scheduleWhere
    , selfNameRow
    , serverBadge
    , serverBlocks
    )

{-| v3/gap-usermodes — the views for the "you on the network" gaps. Every
control reads `model.userModes` and sends `UserModesMsg`; the grouping
mirrors where the person already looks: privacy switches in Preferences,
message requests and offline messages in the Inbox, server blocks next to
the device block list, the account's rooms in Account, the real name on
the self card, an offline person's last-seen on their card and profile,
and the "where to keep it" choice in the send-later picker.

Styling is `css/gap-usermodes.css` (`um-*`, with the shared `pref-*`
switch and row classes reused where the look is identical).
-}

import App exposing (Model, Msg(..))
import Dict
import Html exposing (Html, a, button, details, div, form, h3, h4, input, label, li, p, section, small, span, strong, summary, text, textarea, time, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, for, id, maxlength, placeholder, rows, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Set
import UserModes as U
import View.Sheet as Sheet


um : U.Msg -> Msg
um =
    UserModesMsg


testid : String -> Html.Attribute msg
testid name =
    attribute "data-testid" name


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"


live : Model -> Bool
live model =
    model.connection == App.Live


statusLine : String -> Maybe U.Status -> Html Msg
statusLine key status =
    case status of
        Just s ->
            p
                [ class "um-status"
                , classList [ ( "um-status--error", s.error ) ]
                , attribute "role"
                    (if s.error then
                        "alert"

                     else
                        "status"
                    )
                , testid key
                ]
                [ text s.text ]

        Nothing ->
            text ""


count : Int -> String -> String -> String
count n one many =
    String.fromInt n
        ++ " "
        ++ (if n == 1 then
                one

            else
                many
           )


{-| One name field + button row (a form, so Enter submits). -}
nameForm :
    { key : String
    , labelText : String
    , placeholderText : String
    , buttonText : String
    , value : String
    , onInput : String -> Msg
    , onSubmit : Msg
    , disabled : Bool
    , limit : Int
    }
    -> Html Msg
nameForm f =
    let
        inputId =
            "um-" ++ f.key ++ "-input"
    in
    form [ class "um-form", onSubmit f.onSubmit, testid ("um-" ++ f.key ++ "-form") ]
        [ label [ class "um-sr", for inputId ] [ text f.labelText ]
        , input
            [ type_ "text"
            , id inputId
            , class "um-input"
            , attribute "autocomplete" "off"
            , attribute "autocapitalize" "none"
            , attribute "spellcheck" "false"
            , maxlength f.limit
            , placeholder f.placeholderText
            , value f.value
            , onInput f.onInput
            , testid ("um-" ++ f.key ++ "-input")
            ]
            []
        , button [ type_ "submit", class "um-btn", disabled (f.disabled || String.isEmpty (String.trim f.value)), testid ("um-" ++ f.key ++ "-submit") ] [ text f.buttonText ]
        ]



-- ── Preferences → Privacy ─────────────────────────────────────────────


{-| The Privacy category of the Preferences sheet. -}
privacyPanel : Model -> List (Html Msg)
privacyPanel model =
    let
        state =
            model.userModes

        offered group =
            List.filter (\m -> m.group == group && U.modeAvailable state m.letter) U.privacyModes

        groupView title hint group =
            case offered group of
                [] ->
                    text ""

                modes ->
                    section [ class "pref-group um-group", attribute "aria-label" title ]
                        [ div [ class "pref-group-head" ] [ h3 [ class "pref-label" ] [ text title ] ]
                        , p [ class "pref-desc" ] [ text hint ]
                        , div [ class "um-stack" ] (List.map (modeSwitch model) modes)
                        ]
    in
    [ div [ class "pref-section-head" ]
        [ h3 [ class "pref-section-title" ] [ text "Privacy" ]
        , p [ class "pref-desc" ] [ text "Who can reach you and what others can see. Onyx turns these back on each time you connect from this browser." ]
        ]
    , if live model then
        text ""

      else
        p [ class "um-hint", testid "um-modes-offline" ] [ text "Connect to change these." ]
    , statusLine "um-modes-status" state.modeStatus
    , groupView "Who can message you" "Choose how new conversations reach you." U.Messages
    , if U.modeOn state 'g' || not (List.isEmpty state.accepts) then
        approvedPeople model

      else
        text ""
    , groupView "What people can see" "Quiet the signals others can read about you." U.Visibility
    , case offered U.Advanced of
        [] ->
            text ""

        modes ->
            details [ class "pref-group um-more", testid "um-more" ]
                [ summary [ class "um-more__toggle" ] [ text "More" ]
                , div [ class "um-stack" ] (List.map (modeSwitch model) modes)
                ]
    , section [ class "pref-group um-group", attribute "aria-label" "Blocked people" ]
        [ div [ class "pref-group-head" ] [ h3 [ class "pref-label" ] [ text "Blocked people" ] ]
        , p [ class "pref-desc" ]
            [ text
                (if model.accountName == Nothing then
                    "Muting hides someone on this device."

                 else
                    "Muting hides someone on this device. Signed in, you can also block them on the server so it follows your account."
                )
            ]
        , button
            [ type_ "button"
            , class "pref-reset"
            , attribute "aria-haspopup" "dialog"
            , testid "um-open-blocks"
            , onClick NotifySheetOpen
            ]
            [ text "Manage blocked people" ]
        ]
    ]


modeSwitch : Model -> U.PrivacyMode -> Html Msg
modeSwitch model mode =
    let
        on =
            U.modeOn model.userModes mode.letter

        descId =
            "um-mode-desc-" ++ mode.key
    in
    button
        [ type_ "button"
        , class "pref-toggle um-switch"
        , attribute "role" "switch"
        , attribute "aria-checked" (boolString on)
        , attribute "aria-describedby" descId
        , attribute "aria-busy" (boolString (U.modePending model.userModes mode.letter))
        , attribute "data-mode" (String.fromChar mode.letter)
        , disabled (not (live model))
        , testid ("um-mode-" ++ mode.key)
        , onClick (um (U.ToggleMode mode.letter))
        ]
        [ span [ class "pref-toggle-text" ]
            [ span [ class "pref-toggle-title" ] [ text mode.title ]
            , span [ class "pref-desc", id descId ] [ text mode.description ]
            ]
        , span [ class "pref-switch", attribute "aria-hidden" "true" ] []
        ]


{-| People approved to start a conversation (`+g`). -}
approvedPeople : Model -> Html Msg
approvedPeople model =
    let
        state =
            model.userModes

        peers =
            Dict.values model.channels
                |> List.filter (\c -> not (App.isChannelName model c.name) && String.toLower c.name /= String.toLower model.ourNick)
                |> List.map .name

        approved =
            Set.fromList (List.map String.toLower state.accepts)

        unapproved =
            List.filter (\n -> not (Set.member (String.toLower n) approved)) peers
    in
    section [ class "pref-group um-group um-approved", attribute "aria-labelledby" "um-approved-title", testid "um-approved" ]
        [ div [ class "pref-group-head" ]
            [ h3 [ class "pref-label", id "um-approved-title" ] [ text "Approved people" ]
            , span [ class "pref-count" ] [ text (count (List.length state.accepts) "person" "people") ]
            ]
        , p [ class "pref-desc" ]
            [ text
                (if U.modeOn state 'g' then
                    "Only these people can start a conversation with you. Everyone else shows up as a request in your Inbox."

                 else
                    "These people are approved. The list applies while “Approve new conversations” is on."
                )
            ]
        , if U.modeOn state 'g' && not (List.isEmpty unapproved) then
            button [ type_ "button", class "um-btn um-btn--soft", testid "um-approve-existing", onClick (um U.AcceptExistingDms) ]
                [ text ("Approve people I already message (" ++ String.fromInt (List.length unapproved) ++ ")") ]

          else
            text ""
        , nameForm
            { key = "accept"
            , labelText = "Name to approve"
            , placeholderText = "Name to approve"
            , buttonText = "Approve"
            , value = state.acceptDraft
            , onInput = \v -> um (U.AcceptDraft v)
            , onSubmit = um U.AcceptAdd
            , disabled = not (live model)
            , limit = 64
            }
        , if List.isEmpty state.accepts then
            p [ class "um-hint", testid "um-approved-empty" ]
                [ text
                    (if state.acceptLoading then
                        "Checking your list…"

                     else
                        "Nobody yet. Requests show up in your Inbox."
                    )
                ]

          else
            ul [ class "um-list", attribute "aria-label" "Approved people", testid "um-approved-list" ]
                (List.map
                    (\nick ->
                        li [ class "um-list__row" ]
                            [ span [ class "um-list__name", attribute "title" nick ] [ text nick ]
                            , button
                                [ type_ "button"
                                , class "um-btn um-btn--quiet"
                                , attribute "aria-label" ("Stop approving " ++ nick)
                                , disabled (not (live model))
                                , onClick (um (U.AcceptRemove nick))
                                ]
                                [ text "Remove" ]
                            ]
                    )
                    state.accepts
                )
        , statusLine "um-approved-status" state.acceptStatus
        ]



-- ── Inbox ─────────────────────────────────────────────────────────────


{-| Unseen message requests, added to the bell's count. -}
badgeCount : Model -> Int
badgeCount model =
    model.userModes.requestsUnseen


{-| "X wants to message you" rows with Accept and Ignore. -}
requestsBlock : Model -> Html Msg
requestsBlock model =
    case model.userModes.requests of
        [] ->
            text ""

        requests ->
            section [ class "um-requests", attribute "aria-labelledby" "um-requests-title", testid "message-requests" ]
                [ div [ class "um-requests__head" ]
                    [ h3 [ class "um-requests__title", id "um-requests-title" ] [ text "Message requests" ]
                    , span [ class "um-requests__count" ] [ text (String.fromInt (List.length requests)) ]
                    ]
                , ul [ class "um-requests__list" ]
                    (List.map (requestRow model) requests)
                , button
                    [ type_ "button"
                    , class "um-requests__settings"
                    , testid "um-requests-settings"
                    , onClick (um U.OpenPrivacyPanel)
                    ]
                    [ text "Privacy settings" ]
                ]


requestRow : Model -> U.Request -> Html Msg
requestRow model request =
    li [ class "um-request", testid "message-request", attribute "data-nick" request.nick ]
        [ div [ class "um-request__who" ]
            [ strong [ class "um-request__nick" ] [ text request.nick ]
            , small [ class "um-request__sub" ]
                [ text ("wants to message you · " ++ U.agoText model.nowMs request.atMs) ]
            ]
        , div [ class "um-request__actions" ]
            [ button
                [ type_ "button"
                , class "um-btn um-btn--primary"
                , attribute "aria-label" ("Accept message request from " ++ request.nick)
                , testid "message-request-accept"
                , disabled (not (live model))
                , onClick (um (U.RequestAccept request.nick))
                ]
                [ text "Accept" ]
            , button
                [ type_ "button"
                , class "um-btn um-btn--quiet"
                , attribute "aria-label" ("Ignore message request from " ++ request.nick)
                , testid "message-request-ignore"
                , onClick (um (U.RequestDismiss request.nick))
                ]
                [ text "Ignore" ]
            ]
        ]


{-| The Inbox's quiet link to the mailbox (signed-in only). -}
offlineLink : Model -> Html Msg
offlineLink model =
    case model.accountName of
        Nothing ->
            text ""

        Just _ ->
            let
                waiting =
                    List.length model.userModes.memoWaiting
            in
            button
                [ type_ "button"
                , class "um-inbox-link"
                , attribute "aria-haspopup" "dialog"
                , testid "inbox-offline-messages"
                , onClick (um U.MemoOpen)
                ]
                [ span [ class "um-inbox-link__copy" ]
                    [ strong [] [ text "Offline messages" ]
                    , small [] [ text "Notes left for you while you were away" ]
                    ]
                , if waiting > 0 then
                    span [ class "um-inbox-link__count" ] [ text (String.fromInt waiting) ]

                  else
                    span [ class "um-inbox-link__chevron", attribute "aria-hidden" "true" ] []
                ]



-- ── Offline messages sheet ────────────────────────────────────────────


memoSheet : Model -> Html Msg
memoSheet model =
    if not model.userModes.memoOpen then
        text ""

    else
        let
            state =
                model.userModes

            signedIn =
                model.accountName /= Nothing
        in
        Sheet.view
            { scope = "memo"
            , label = Sheet.LabelledBy "um-memo-title"
            , onClose = um U.MemoClose
            , placement = Sheet.Center
            , layerClass = "um-memo-layer"
            , panelClass = "um-memo"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ testid "offline-messages" ]
            }
            [ Sheet.headerWith
                (Sheet.head { scope = "memo", title = "Offline messages", closeLabel = "Close offline messages", onClose = um U.MemoClose }
                    |> (\h ->
                            { h
                                | titleId = Just "um-memo-title"
                                , subtitle = Just "Notes people leave for you while you are away, and notes you leave for them."
                                , closeTestId = Just "offline-messages-close"
                            }
                       )
                )
            , if not signedIn then
                p [ class "um-memo__guest", testid "um-memo-guest" ]
                    [ text "Offline messages belong to an Onyx account. Sign in to leave and receive them." ]

              else
                div [ class "um-memo__body" ]
                    [ statusLine "um-memo-status" state.memoStatus
                    , waitingSection model
                    , arrivedSection model
                    , sendSection model
                    , forwardSection model
                    , blockedSendersSection model
                    ]
            ]


waitingSection : Model -> Html Msg
waitingSection model =
    let
        state =
            model.userModes

        waiting =
            state.memoWaiting
    in
    section [ class "um-memo__section", attribute "aria-labelledby" "um-memo-waiting-title", testid "um-memo-waiting" ]
        [ div [ class "um-memo__head" ]
            [ h4 [ class "um-memo__title", id "um-memo-waiting-title" ] [ text "Waiting for you" ]
            , button
                [ type_ "button"
                , class "um-btn um-btn--quiet"
                , disabled (not (live model) || state.memoListing)
                , testid "um-memo-refresh"
                , onClick (um U.MemoRefresh)
                ]
                [ text
                    (if state.memoListing then
                        "Checking…"

                     else
                        "Refresh"
                    )
                ]
            ]
        , if List.isEmpty waiting then
            p [ class "um-hint", testid "um-memo-empty" ]
                [ text
                    (if state.memoKnown || not (live model) then
                        "Nothing is waiting. A note someone leaves while you are away arrives as a message the next time you sign in."

                     else
                        "Checking for notes…"
                    )
                ]

          else
            ul [ class "um-memo__list", attribute "aria-label" "Messages waiting for you" ]
                (List.map (memoRow model) waiting)
        , if List.isEmpty waiting then
            text ""

          else if state.memoClearAsk then
            div [ class "um-confirm", attribute "role" "group", attribute "aria-label" "Confirm clearing offline messages" ]
                [ p [ class "um-hint" ] [ text ("Clear " ++ count (List.length waiting) "waiting message" "waiting messages" ++ "? They are deleted from the server and can't be brought back.") ]
                , div [ class "um-actions" ]
                    [ button [ type_ "button", class "um-btn um-btn--danger", testid "um-memo-clear-confirm", onClick (um U.MemoClearConfirm) ] [ text "Clear them" ]
                    , button [ type_ "button", class "um-btn", onClick (um U.MemoClearCancel) ] [ text "Keep them" ]
                    ]
                ]

          else
            div [ class "um-actions" ]
                [ button [ type_ "button", class "um-btn um-btn--quiet", testid "um-memo-clear", disabled (not (live model)), onClick (um U.MemoClearAsk) ] [ text "Clear all" ] ]
        ]


memoRow : Model -> U.Memo -> Html Msg
memoRow model memo =
    li [ class "um-memo__row", testid "um-memo-row" ]
        [ div [ class "um-memo__who" ]
            [ strong [] [ text memo.from ]
            , button
                [ type_ "button"
                , class "um-btn um-btn--quiet"
                , attribute "aria-label" ("Open a chat with " ++ memo.from)
                , onClick (um (U.MemoOpenDm memo.from))
                ]
                [ text "Reply" ]
            ]
        , p [ class "um-memo__text" ] [ text memo.text ]
        , small [ class "um-memo__when" ] [ text (U.agoText model.nowMs memo.atMs) ]
        ]


{-| Notes that arrived on sign-in this session (they are already DMs). -}
arrivedSection : Model -> Html Msg
arrivedSection model =
    case model.userModes.memoDelivered of
        [] ->
            text ""

        delivered ->
            section [ class "um-memo__section", attribute "aria-labelledby" "um-memo-arrived-title", testid "um-memo-arrived" ]
                [ h4 [ class "um-memo__title", id "um-memo-arrived-title" ] [ text "Arrived since you signed in" ]
                , ul [ class "um-memo__list" ]
                    (List.map
                        (\memo ->
                            li [ class "um-memo__row" ]
                                [ div [ class "um-memo__who" ]
                                    [ strong [] [ text memo.from ]
                                    , button
                                        [ type_ "button"
                                        , class "um-btn um-btn--quiet"
                                        , attribute "aria-label" ("Open the chat with " ++ memo.from)
                                        , onClick (um (U.MemoOpenDm memo.from))
                                        ]
                                        [ text "Open chat" ]
                                    ]
                                , p [ class "um-memo__text" ] [ text memo.text ]
                                ]
                        )
                        (List.reverse (List.take 5 (List.reverse delivered)))
                    )
                ]


sendSection : Model -> Html Msg
sendSection model =
    let
        state =
            model.userModes

        used =
            String.length state.memoText
    in
    details [ class "um-memo__section um-fold", testid "um-memo-send" ]
        [ summary [ class "um-fold__toggle" ] [ text "Leave a message" ]
        , form [ class "um-memo__compose", onSubmit (um U.MemoSend) ]
            [ label [ class "um-label", for "um-memo-to" ] [ text "To (account name)" ]
            , input
                [ type_ "text"
                , id "um-memo-to"
                , class "um-input"
                , attribute "autocomplete" "off"
                , attribute "autocapitalize" "none"
                , attribute "spellcheck" "false"
                , maxlength 64
                , value state.memoTo
                , onInput (\v -> um (U.MemoTo v))
                , testid "um-memo-to"
                ]
                []
            , label [ class "um-label", for "um-memo-text" ] [ text "Message" ]
            , textarea
                [ id "um-memo-text"
                , class "um-input um-input--area"
                , rows 3
                , maxlength U.memoMaxLength
                , value state.memoText
                , onInput (\v -> um (U.MemoText v))
                , testid "um-memo-text"
                ]
                []
            , div [ class "um-memo__foot" ]
                [ small [ class "um-memo__counter", attribute "aria-live" "off" ] [ text (String.fromInt used ++ " / " ++ String.fromInt U.memoMaxLength) ]
                , button
                    [ type_ "submit"
                    , class "um-btn um-btn--primary"
                    , disabled (not (live model) || state.memoSending || String.isEmpty (String.trim state.memoText) || String.isEmpty (String.trim state.memoTo))
                    , testid "um-memo-send-submit"
                    ]
                    [ text
                        (if state.memoSending then
                            "Sending…"

                         else
                            "Leave message"
                        )
                    ]
                ]
            , p [ class "um-hint" ] [ text "They get it the next time they sign in. Only Onyx accounts can receive offline messages." ]
            ]
        ]


forwardSection : Model -> Html Msg
forwardSection model =
    let
        state =
            model.userModes
    in
    details [ class "um-memo__section um-fold", testid "um-memo-forward" ]
        [ summary [ class "um-fold__toggle" ]
            [ text "Forwarding"
            , case state.memoForward of
                Just account ->
                    small [ class "um-fold__state" ] [ text ("to " ++ account) ]

                Nothing ->
                    text ""
            ]
        , p [ class "um-hint" ]
            [ text
                (case state.memoForward of
                    Just account ->
                        "Notes left for you also go to " ++ account ++ "."

                    Nothing ->
                        "Send the notes left for you to another account as well."
                )
            ]
        , nameForm
            { key = "forward"
            , labelText = "Account to forward to"
            , placeholderText = "Account to forward to"
            , buttonText = "Forward"
            , value = state.memoForwardDraft
            , onInput = \v -> um (U.MemoForwardDraft v)
            , onSubmit = um U.MemoForwardSet
            , disabled = not (live model)
            , limit = 64
            }
        , case state.memoForward of
            Just _ ->
                div [ class "um-actions" ]
                    [ button [ type_ "button", class "um-btn um-btn--quiet", testid "um-memo-forward-off", disabled (not (live model)), onClick (um U.MemoForwardOff) ] [ text "Turn forwarding off" ] ]

            Nothing ->
                text ""
        ]


blockedSendersSection : Model -> Html Msg
blockedSendersSection model =
    let
        state =
            model.userModes
    in
    details [ class "um-memo__section um-fold", testid "um-memo-ignores" ]
        [ summary [ class "um-fold__toggle" ]
            [ text "Blocked senders"
            , if List.isEmpty state.memoIgnores then
                text ""

              else
                small [ class "um-fold__state" ] [ text (String.fromInt (List.length state.memoIgnores)) ]
            ]
        , p [ class "um-hint" ] [ text "Notes from these accounts are dropped before they reach you." ]
        , nameForm
            { key = "memo-ignore"
            , labelText = "Account to block"
            , placeholderText = "Account to block"
            , buttonText = "Block"
            , value = state.memoIgnoreDraft
            , onInput = \v -> um (U.MemoIgnoreDraft v)
            , onSubmit = um U.MemoIgnoreAdd
            , disabled = not (live model)
            , limit = 64
            }
        , if List.isEmpty state.memoIgnores then
            text ""

          else
            ul [ class "um-list", attribute "aria-label" "Blocked senders" ]
                (List.map
                    (\account ->
                        li [ class "um-list__row" ]
                            [ span [ class "um-list__name", attribute "title" account ] [ text account ]
                            , button
                                [ type_ "button"
                                , class "um-btn um-btn--quiet"
                                , attribute "aria-label" ("Allow notes from " ++ account ++ " again")
                                , disabled (not (live model))
                                , onClick (um (U.MemoIgnoreRemove account))
                                ]
                                [ text "Allow" ]
                            ]
                    )
                    state.memoIgnores
                )
        ]



-- ── server blocks (inside the device block list) ──────────────────────


{-| "Also block on the server" and the server-only blocks. -}
serverBlocks : Model -> Html Msg
serverBlocks model =
    case model.accountName of
        Nothing ->
            p [ class "um-hint um-hint--inline", testid "um-blocks-signin" ]
                [ text "Sign in to also block people on the server, so blocks follow your account to every device." ]

        Just _ ->
            let
                state =
                    model.userModes

                limit =
                    model.isupport.silence

                missing =
                    Set.toList model.ignoredUsers
                        |> List.filter (\n -> not (U.silencedOnServer state n))

                extra =
                    U.serverOnlyBlocks model.ignoredUsers state
            in
            div [ class "um-blocks", testid "um-server-blocks" ]
                [ button
                    [ type_ "button"
                    , class "pref-toggle um-switch"
                    , attribute "role" "switch"
                    , attribute "aria-checked" (boolString state.serverIgnore)
                    , attribute "aria-describedby" "um-serverignore-desc"
                    , testid "um-serverignore"
                    , onClick (um (U.ServerIgnoreSet (not state.serverIgnore)))
                    ]
                    [ span [ class "pref-toggle-text" ]
                        [ span [ class "pref-toggle-title" ] [ text "Also block on the server" ]
                        , span [ class "pref-desc", id "um-serverignore-desc" ]
                            [ text
                                ("New blocks follow your account to every device, and blocked people can't message you at all. They are not told."
                                    ++ (if limit > 0 then
                                            " The server keeps up to " ++ String.fromInt limit ++ "."

                                        else
                                            ""
                                       )
                                )
                            ]
                        ]
                    , span [ class "pref-switch", attribute "aria-hidden" "true" ] []
                    ]
                , statusLine "um-silence-status" state.silenceStatus
                , if state.serverIgnore && not (List.isEmpty missing) then
                    div [ class "um-actions" ]
                        [ button
                            [ type_ "button"
                            , class "um-btn um-btn--soft"
                            , testid "um-silence-sync"
                            , disabled (model.connection /= App.Live)
                            , onClick (um U.SilenceSyncAll)
                            ]
                            [ text ("Block " ++ count (List.length missing) "listed name" "listed names" ++ " on the server too") ]
                        ]

                  else
                    text ""
                , if List.isEmpty extra then
                    text ""

                  else
                    div [ class "um-blocks__extra" ]
                        [ h4 [ class "um-blocks__title" ] [ text "Also blocked on the server" ]
                        , if state.serverIgnore then
                            text ""

                          else
                            p [ class "um-hint" ] [ text "These stay until you unblock them here." ]
                        , ul [ class "um-list", attribute "aria-label" "Blocked on the server", testid "um-silence-list" ]
                            (List.map
                                (\mask ->
                                    li [ class "um-list__row" ]
                                        [ span [ class "um-list__name", attribute "title" mask ] [ text (Maybe.withDefault mask (U.silencedNick mask)) ]
                                        , button
                                            [ type_ "button"
                                            , class "um-btn um-btn--quiet"
                                            , attribute "aria-label" ("Unblock " ++ mask ++ " on the server")
                                            , disabled (model.connection /= App.Live)
                                            , onClick (um (U.SilenceRemove mask))
                                            ]
                                            [ text "Unblock" ]
                                        ]
                                )
                                extra
                            )
                        ]
                ]


{-| A small tag on a device-block row that is also a server block. -}
serverBadge : Model -> String -> Html Msg
serverBadge model nick =
    if U.silencedOnServer model.userModes nick then
        small [ class "um-tag", attribute "title" "Also blocked on the server" ] [ text "server" ]

    else
        text ""



-- ── Account → rooms I join automatically ──────────────────────────────


autojoinNavItem : Html Msg
autojoinNavItem =
    a [ class "onyx-account-nav__item", Html.Attributes.href "#acct-autojoin-title" ] [ text "Rooms" ]


autojoinSection : Model -> Html Msg
autojoinSection model =
    let
        state =
            model.userModes

        here =
            case model.activeChannel of
                Just c ->
                    if App.isChannelName model c && not (List.member (String.toLower c) (List.map String.toLower state.autojoins)) then
                        Just c

                    else
                        Nothing

                Nothing ->
                    Nothing
    in
    section [ class "onyx-account-section um-autojoin", id "acct-autojoin-title", testid "account-autojoin" ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Rooms I join automatically" ]
        , p [ class "onyx-account-hint" ] [ text "Signing in joins these rooms on every device." ]
        , nameForm
            { key = "autojoin"
            , labelText = "Room to join automatically"
            , placeholderText = "#room"
            , buttonText = "Add"
            , value = state.autojoinDraft
            , onInput = \v -> um (U.AutojoinDraft v)
            , onSubmit = um U.AutojoinAddDraft
            , disabled = not (live model)
            , limit = 64
            }
        , case here of
            Just c ->
                div [ class "um-actions" ]
                    [ button [ type_ "button", class "um-btn um-btn--soft", testid "um-autojoin-here", disabled (not (live model)), onClick (um (U.AutojoinAdd c)) ]
                        [ text ("Add " ++ c) ]
                    ]

            Nothing ->
                text ""
        , if List.isEmpty state.autojoins then
            p [ class "um-hint", testid "um-autojoin-empty" ]
                [ text
                    (if state.autojoinListing then
                        "Loading your rooms…"

                     else
                        "No rooms yet."
                    )
                ]

          else
            ul [ class "um-list", attribute "aria-label" "Rooms joined automatically", testid "um-autojoin-list" ]
                (List.map
                    (\room ->
                        li [ class "um-list__row" ]
                            [ span [ class "um-list__name", attribute "title" room ] [ text room ]
                            , button
                                [ type_ "button"
                                , class "um-btn um-btn--quiet"
                                , attribute "aria-label" ("Stop joining " ++ room ++ " automatically")
                                , disabled (not (live model))
                                , onClick (um (U.AutojoinRemove room))
                                ]
                                [ text "Remove" ]
                            ]
                    )
                    state.autojoins
                )
        , statusLine "um-autojoin-status" state.autojoinStatus
        ]



-- ── profile depth ─────────────────────────────────────────────────────


{-| Your own network name (SETNAME), on your own card. -}
selfNameRow : Model -> Html Msg
selfNameRow model =
    let
        state =
            model.userModes

        shown =
            U.realnameShown state model.ourNick
    in
    div [ class "um-selfname", testid "um-selfname" ]
        [ case state.realnameDraft of
            Nothing ->
                div [ class "um-selfname__view" ]
                    [ div [ class "um-selfname__copy" ]
                        [ small [ class "um-selfname__label" ] [ text "Name on the network" ]
                        , span [ class "um-selfname__value", attribute "title" shown ] [ text shown ]
                        ]
                    , button [ type_ "button", id "um-selfname-edit", class "um-btn um-btn--quiet", testid "um-selfname-edit", onClick (um U.RealnameEdit) ] [ text "Edit" ]
                    ]

            Just draft ->
                form [ class "um-selfname__edit", onSubmit (um U.RealnameSave) ]
                    [ label [ class "um-label", for "um-selfname-input" ] [ text "Name on the network" ]
                    , input
                        [ type_ "text"
                        , id "um-selfname-input"
                        , class "um-input"
                        , attribute "autocomplete" "off"
                        , maxlength U.maxRealnameLength
                        , placeholder (model.ourNick ++ " (webchat)")
                        , value draft
                        , onInput (\v -> um (U.RealnameInput v))
                        , testid "um-selfname-input"
                        ]
                        []
                    , div [ class "um-actions" ]
                        [ button [ type_ "submit", class "um-btn um-btn--primary", testid "um-selfname-save" ] [ text "Save" ]
                        , button [ type_ "button", class "um-btn", onClick (um U.RealnameCancel) ] [ text "Cancel" ]
                        , if String.isEmpty state.realname then
                            text ""

                          else
                            button [ type_ "button", class "um-btn um-btn--quiet", testid "um-selfname-reset", onClick (um U.RealnameReset) ] [ text "Use the default" ]
                        ]
                    ]
        , statusLine "um-selfname-status" state.realnameStatus
        ]


{-| What WHOWAS and SEEN said about someone who is offline. -}
offlineBlock : Model -> String -> Html Msg
offlineBlock model nick =
    case U.offlineFor nick model.userModes of
        Nothing ->
            text ""

        Just offline ->
            div [ class "um-offline", testid "offline-profile" ]
                (if offline.loading && offline.leftMs == Nothing && offline.lastSeenMs == Nothing then
                    [ p [ class "um-offline__line", attribute "role" "status" ] [ text "Checking when they were last here…" ] ]

                 else
                    case U.lastSeenLine model.nowMs offline of
                        Just line ->
                            [ p [ class "um-offline__line" ] [ text line ] ]
                                ++ (case offline.name of
                                        Just name ->
                                            [ p [ class "um-offline__sub" ] [ text ("Went by “" ++ name ++ "”") ] ]

                                        Nothing ->
                                            []
                                   )

                        Nothing ->
                            [ p [ class "um-offline__line um-offline__line--none" ] [ text "Onyx has no record of when they were last here." ] ]
                )


{-| On the card of someone not in the room: ask when they were last here. -}
lastSeenButton : Model -> String -> Maybe String -> Html Msg
lastSeenButton model nick account =
    case U.offlineFor nick model.userModes of
        Just _ ->
            offlineBlock model nick

        Nothing ->
            button
                [ type_ "button"
                , class "um-btn um-btn--quiet um-lastseen"
                , testid "um-lastseen"
                , attribute "aria-label" ("Check when " ++ nick ++ " was last here")
                , disabled (model.connection /= App.Live)
                , onClick (um (U.ProfileLookup { nick = nick, account = account }))
                ]
                [ text "When were they last here?" ]



-- ── send-later: where to keep it ──────────────────────────────────────


scheduleWhere : Model -> Html Msg
scheduleWhere model =
    case model.accountName of
        Nothing ->
            p [ class "um-hint um-where__signin", testid "um-schedule-signin" ]
                [ text "Sign in to have the server send it while you're away." ]

        Just _ ->
            let
                check =
                    App.userModesDeferCheck model

                eligible =
                    check == U.DeferOk

                server =
                    model.userModes.deferServer && eligible

                option key title hint selected enabled msg =
                    button
                        [ type_ "button"
                        , class "um-choice"
                        , classList [ ( "um-choice--on", selected ) ]
                        , attribute "role" "radio"
                        , attribute "aria-checked" (boolString selected)
                        , attribute "aria-describedby" ("um-where-" ++ key ++ "-hint")
                        , disabled (not enabled)
                        , testid ("um-where-" ++ key)
                        , onClick (um msg)
                        ]
                        [ span [ class "um-choice__title" ] [ text title ]
                        , span [ class "um-choice__hint", id ("um-where-" ++ key ++ "-hint") ] [ text hint ]
                        ]
            in
            div [ class "um-where", attribute "role" "radiogroup", attribute "aria-label" "Where to keep it", testid "um-where" ]
                [ option "device" "On this device" "Sends while a tab is open. You can cancel it." (not server) True (U.DeferChoose False)
                , option "server"
                    "On the server"
                    (if eligible then
                        "Sends even if you close the tab. It can't be cancelled."

                     else
                        U.deferCheckCopy check
                    )
                    server
                    eligible
                    (U.DeferChoose True)
                ]


{-| Server-held sends in the scheduled sheet: label and all. -}
heldRows : Model -> List (Html Msg)
heldRows model =
    let
        held =
            U.heldPending model.nowMs model.userModes
                |> List.filter (\h -> Maybe.map String.toLower model.accountName == Just (String.toLower h.account))
    in
    if List.isEmpty held then
        []

    else
        [ section [ class "um-held", attribute "aria-labelledby" "um-held-title", testid "um-held" ]
            [ h4 [ class "um-held__title", id "um-held-title" ] [ text "Held by the server" ]
            , p [ class "um-hint" ] [ text "These send even if you close the tab. The server can't cancel them." ]
            , ul [ class "onyx-scheduled-list", attribute "aria-label" "Messages held by the server" ]
                (List.map
                    (\h ->
                        li [ class "onyx-scheduled-item um-held__item", testid "um-held-item" ]
                            [ div [ class "onyx-scheduled-meta" ]
                                [ span [ class "onyx-scheduled-channel" ] [ text ("Room · " ++ h.channel) ]
                                , time [ class "onyx-scheduled-when", attribute "datetime" (App.millisToIso (toFloat h.sendAt)) ]
                                    [ text (App.scheduleSendLabel h.sendAt (floor model.nowMs)) ]
                                ]
                            , p [ class "onyx-scheduled-text" ] [ text h.text ]
                            , span [ class "um-tag um-tag--lock" ] [ text "Can't be cancelled" ]
                            ]
                    )
                    held
                )
            ]
        ]
