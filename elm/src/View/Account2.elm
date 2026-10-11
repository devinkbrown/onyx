module View.Account2 exposing
    ( friendPresence
    , friendPresenceLabel
    , peopleSheet
    , portableSection
    , reclaimBanner
    , revokeOthers
    , themeShareSheet
    , youEntries
    , youStatusBlock
    )

{-| v3/account2 — account completeness surfaces.

  - `reclaimBanner` mirrors `shell/SessionReclaimBanner.tsx` (four
    phases, `role="status"`, Sign in again → disconnect to the gate).
  - `revokeOthers` adds the bulk "Revoke other devices" action of
    `shell/SessionsDevicesSection.tsx`; the oracle's `window.confirm`
    becomes an inline confirm row.
  - `portableSection` mirrors `shell/PortableIdentitySection.tsx`
    (favorites only: room folders and quiet hours are not carried).
  - `themeShareSheet` mirrors `shell/ThemeImportDialog.tsx`.
  - `peopleSheet`, `youStatusBlock`, `youEntries` and `friendPresence`
    surface the friends / watch list, custom status (+ expiry),
    presence and DND folds, which have no oracle component (the oracle
    store holds the same verbs with no UI).

-}

import Account2 exposing (CopyStatus(..))
import App exposing (Model, Msg(..), ReclaimPhase(..), UserStatus(..))
import Dict
import Html exposing (Html, button, div, form, h3, input, label, li, option, p, section, select, small, span, strong, text, textarea, ul)
import Html.Attributes exposing (attribute, class, disabled, for, id, maxlength, placeholder, rows, selected, spellcheck, type_, value)
import Html.Events exposing (on, onClick, onInput, onSubmit)
import Json.Decode as Decode
import Session
import Studio
import ThemeTokens
import View.Sheet as Sheet



-- SESSION RECLAIM BANNER


reclaimBanner : Model -> Html Msg
reclaimBanner model =
    case model.sessionReclaim of
        Nothing ->
            text ""

        Just notice ->
            let
                ( key, ( title, detail ) ) =
                    reclaimCopy notice.phase

                actionable =
                    notice.phase == ReclaimFailed || notice.phase == SignInAgain
            in
            div
                [ class "a2-reclaim"
                , class
                    (if notice.phase == Reclaimed then
                        "a2-reclaim--success"

                     else if actionable then
                        "a2-reclaim--alert"

                     else
                        ""
                    )
                , attribute "data-state" key
                , attribute "data-testid" "session-reclaim-banner"
                , attribute "role" "status"
                , attribute "aria-live" "polite"
                , attribute "aria-atomic" "true"
                ]
                [ span [ class "a2-reclaim__glyph", attribute "aria-hidden" "true" ]
                    [ text
                        (if notice.phase == Reclaimed then
                            "✓"

                         else if actionable then
                            "⚠"

                         else
                            "⋯"
                        )
                    ]
                , span [ class "a2-reclaim__text" ]
                    [ span [ class "a2-reclaim__title" ] [ text title ]
                    , if String.isEmpty detail then
                        text ""

                      else
                        span [ class "a2-reclaim__detail" ] [ text detail ]
                    ]
                , if actionable then
                    button
                        [ type_ "button"
                        , class "a2-reclaim__signin"
                        , attribute "data-testid" "session-reclaim-signin"
                        , onClick SessionReclaimSignIn
                        ]
                        [ text "Sign in again" ]

                  else
                    text ""
                , button
                    [ type_ "button"
                    , class "a2-reclaim__dismiss"
                    , attribute "data-testid" "session-reclaim-dismiss"
                    , attribute "aria-label" "Dismiss"
                    , onClick SessionReclaimDismiss
                    ]
                    [ span [ class "onyx-sheet-x", attribute "aria-hidden" "true" ] [] ]
                ]


reclaimCopy : ReclaimPhase -> ( String, ( String, String ) )
reclaimCopy phase =
    case phase of
        Restoring ->
            ( "restoring", ( "Restoring your session…", "Reconnecting you to where you left off." ) )

        Reclaimed ->
            ( "reclaimed", ( "Session restored", "" ) )

        ReclaimFailed ->
            ( "reclaim-failed", ( "Couldn't restore your session", "Sign in again to keep going." ) )

        SignInAgain ->
            ( "sign-in-again", ( "Your session has expired", "Sign in again to keep going." ) )



-- REVOKE OTHER DEVICES


revokeOthers : Model -> Html Msg
revokeOthers model =
    let
        others =
            Session.otherAttachedSessions model.accountSessions
    in
    if List.isEmpty others then
        text ""

    else if model.sessionsRevokeConfirm then
        div [ class "a2-confirm", attribute "role" "group", attribute "aria-label" "Confirm revoke", attribute "data-testid" "sessions-revoke-confirm" ]
            [ p [ class "a2-confirm__copy" ] [ text (Account2.revokeOthersPrompt (List.length others)) ]
            , div [ class "a2-row" ]
                [ button
                    [ type_ "button"
                    , class "a2-btn a2-btn--danger"
                    , attribute "data-testid" "sessions-revoke-others-confirm"
                    , disabled model.accountSessionsPending
                    , onClick SessionsRevokeOthersConfirm
                    ]
                    [ text "Revoke" ]
                , button
                    [ type_ "button"
                    , class "a2-btn"
                    , attribute "data-testid" "sessions-revoke-others-cancel"
                    , onClick SessionsRevokeOthersCancel
                    ]
                    [ text "Cancel" ]
                ]
            ]

    else
        button
            [ type_ "button"
            , class "a2-btn"
            , attribute "data-testid" "sessions-revoke-others"
            , disabled model.accountSessionsPending
            , onClick SessionsRevokeOthersAsk
            ]
            [ text "Revoke other devices" ]



-- PORTABLE RESIDENCE


portableSection : Model -> Html Msg
portableSection model =
    let
        noOwner =
            App.deviceMemoryOwner model == Nothing
    in
    section
        [ class "onyx-account-section a2-portable"
        , id "acct-portable-title"
        , attribute "aria-describedby" "acct-portable-hint"
        , attribute "data-testid" "portable-identity-section"
        ]
        [ h3 [ class "onyx-account-section__title" ] [ text "Portable residence" ]
        , p [ class "onyx-account-hint", id "acct-portable-hint" ]
            [ text "Move favorites between browsers. Never includes passwords, device keys, session tokens, or recovery codes." ]
        , div [ class "a2-row" ]
            [ button
                [ type_ "button"
                , class "a2-btn"
                , attribute "data-testid" "portable-export-download"
                , disabled noOwner
                , onClick PortableExportDownload
                ]
                [ text "Download residence file" ]
            , button
                [ type_ "button"
                , class "a2-btn"
                , attribute "data-testid" "portable-export-copy"
                , disabled noOwner
                , onClick PortableExportCopy
                ]
                [ text "Copy JSON" ]
            ]
        , label [ class "a2-label", for "portable-import-json" ] [ text "Import residence JSON" ]
        , textarea
            [ id "portable-import-json"
            , class "a2-textarea"
            , attribute "data-testid" "portable-import-json"
            , rows 4
            , spellcheck False
            , placeholder "{\"kind\":\"onyx.portable-identity\",...}"
            , value model.portableImport
            , onInput PortableImportInput
            , disabled noOwner
            ]
            []
        , div [ class "a2-row" ]
            [ button
                [ type_ "button"
                , class "a2-btn"
                , attribute "data-testid" "portable-import"
                , disabled (noOwner || String.isEmpty (String.trim model.portableImport))
                , onClick PortableImportSubmit
                ]
                [ text "Import" ]
            ]
        , case model.portableStatus of
            Just msg ->
                p [ class "onyx-account-hint", attribute "role" "status", attribute "data-testid" "portable-status" ] [ text msg ]

            Nothing ->
                text ""
        , case model.portableError of
            Just msg ->
                p [ class "onyx-account-error", attribute "role" "alert", attribute "data-testid" "portable-error" ] [ text msg ]

            Nothing ->
                text ""
        ]



-- THEME SHARE / IMPORT


themeShareSheet : Model -> Html Msg
themeShareSheet model =
    if not model.themeShareOpen then
        text ""

    else
        let
            imported =
                Studio.decodeThemeShare ThemeTokens.themeIds (Account2.extractThemeCode model.themeShareInput)

            hasInput =
                not (String.isEmpty (String.trim model.themeShareInput))

            invalid =
                hasInput && imported == Nothing

            shareTheme =
                Account2.shareTheme model.themeId model.studioCustoms

            shareName =
                Maybe.map .name shareTheme |> Maybe.withDefault "current theme"

            shareUrl =
                Account2.shareUrl model.themeId model.studioCustoms model.origin |> Maybe.withDefault ""
        in
        Sheet.view
            { scope = "theme-share"
            , label = Sheet.LabelledBy (Sheet.titleId "theme-share")
            , onClose = ThemeShareClose
            , placement = Sheet.Center
            , layerClass = ""
            , panelClass = "a2-sheet"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = []
            }
            [ Sheet.header { scope = "theme-share", title = "Share & import a theme", closeLabel = "Close", onClose = ThemeShareClose, closeTestId = Nothing }
            , div [ class "a2-body", attribute "data-testid" "theme-import-dialog" ]
                [ section [ class "a2-section", attribute "aria-labelledby" "theme-import-heading" ]
                    [ h3 [ class "a2-heading", id "theme-import-heading" ] [ text "Import" ]
                    , label [ class "a2-label", for "theme-import-code" ] [ text "Theme code or link" ]
                    , p [ class "a2-hint", id "theme-import-help" ]
                        [ text "Paste a shared Onyx theme code or link. It is checked locally before import; no code is run." ]
                    , textarea
                        ([ id "theme-import-code"
                         , class "a2-textarea"
                         , rows 5
                         , spellcheck False
                         , value model.themeShareInput
                         , onInput ThemeShareInput
                         , Sheet.autofocus "theme-share"
                         , attribute "aria-describedby"
                            (if invalid then
                                "theme-import-help theme-import-error"

                             else
                                "theme-import-help"
                            )
                         ]
                            ++ (if invalid then
                                    [ attribute "aria-invalid" "true" ]

                                else
                                    []
                               )
                        )
                        []
                    , case imported of
                        Just theme ->
                            div [ class "a2-ready", attribute "role" "status" ]
                                [ span [ class "a2-ready__label" ] [ text "Ready" ]
                                , strong [ class "a2-ready__name" ] [ text theme.name ]
                                , button
                                    [ type_ "button"
                                    , class "a2-btn a2-btn--primary"
                                    , attribute "aria-label" ("Import theme " ++ theme.name)
                                    , onClick ThemeShareImport
                                    ]
                                    [ text "Import theme" ]
                                ]

                        Nothing ->
                            text ""
                    , if invalid then
                        p [ class "a2-error", id "theme-import-error" ] [ text "That doesn't look like a valid theme code." ]

                      else
                        text ""
                    ]
                , case shareTheme of
                    Nothing ->
                        text ""

                    Just _ ->
                        section [ class "a2-section", attribute "aria-labelledby" "theme-share-heading" ]
                            [ h3 [ class "a2-heading", id "theme-share-heading" ] [ text "Share" ]
                            , label [ class "a2-label", for "theme-share-link" ] [ text "Share link" ]
                            , div [ class "a2-row a2-row--fill" ]
                                [ input
                                    [ id "theme-share-link"
                                    , class "a2-input"
                                    , value shareUrl
                                    , attribute "readonly" "readonly"
                                    ]
                                    []
                                , button
                                    [ type_ "button"
                                    , class "a2-btn"
                                    , disabled (String.isEmpty shareUrl)
                                    , attribute "aria-label" ("Copy share link for " ++ shareName)
                                    , onClick ThemeShareCopy
                                    ]
                                    [ text
                                        (case model.themeShareCopy of
                                            CopyDone ->
                                                "Copied"

                                            CopyFailed ->
                                                "Copy failed"

                                            CopyIdle ->
                                                "Copy link"
                                        )
                                    ]
                                ]
                            , span [ class "a2-sr", attribute "role" "status", attribute "aria-live" "polite", attribute "aria-atomic" "true" ]
                                [ text
                                    (case model.themeShareCopy of
                                        CopyDone ->
                                            "Share link copied for " ++ shareName ++ "."

                                        CopyFailed ->
                                            "Could not copy the share link for " ++ shareName ++ ". Select and copy it from the field."

                                        CopyIdle ->
                                            ""
                                    )
                                ]
                            ]
                ]
            ]



-- YOU HUB: STATUS, PRESENCE, DND


youStatusBlock : Model -> Html Msg
youStatusBlock model =
    let
        expired =
            Account2.statusExpired model.customStatusExpiry model.nowMs

        current =
            if expired then
                ""

            else
                model.customStatus

        dndOn =
            model.userStatus == StatusDnd || App.notifyDndActive model
    in
    section [ class "a2-status", attribute "aria-label" "Status", attribute "data-testid" "you-status" ]
        [ div [ class "a2-row a2-row--between" ]
            [ label [ class "a2-label", for "you-presence" ] [ text "Presence" ]
            , if dndOn then
                span [ class "a2-dnd", attribute "data-testid" "you-dnd" ]
                    [ text
                        (if model.userStatus == StatusDnd then
                            "Do not disturb"

                         else
                            "Notifications paused"
                        )
                    ]

              else
                text ""
            ]
        , select
            [ id "you-presence"
            , class "a2-select"
            , attribute "data-testid" "you-presence"
            , on "change" (Decode.map presenceMsg (Decode.at [ "target", "value" ] Decode.string))
            ]
            (List.map
                (\( key, status, copy ) ->
                    option [ value key, selected (model.userStatus == status) ] [ text copy ]
                )
                presenceOptions
            )
        , case model.statusEditing of
            Nothing ->
                div [ class "a2-row a2-row--between a2-status__current" ]
                    [ span [ class "a2-status__text", attribute "data-testid" "you-custom-status" ]
                        (if String.isEmpty current then
                            [ span [ class "a2-faint" ] [ text "No status set" ] ]

                         else
                            [ text current
                            , case Account2.expiryLabel model.customStatusExpiry model.nowMs of
                                "" ->
                                    text ""

                                copy ->
                                    small [ class "a2-faint" ] [ text (" · " ++ copy) ]
                            ]
                        )
                    , div [ class "a2-row" ]
                        [ button
                            [ type_ "button"
                            , class "a2-btn"
                            , attribute "data-testid" "you-status-edit"
                            , onClick StatusEditStart
                            ]
                            [ text
                                (if String.isEmpty current then
                                    "Set a status"

                                 else
                                    "Edit status"
                                )
                            ]
                        , if String.isEmpty current then
                            text ""

                          else
                            button
                                [ type_ "button"
                                , class "a2-btn"
                                , attribute "data-testid" "you-status-clear"
                                , onClick StatusClear
                                ]
                                [ text "Clear" ]
                        ]
                    ]

            Just draft ->
                form [ class "a2-status__form", onSubmit StatusEditSave, attribute "data-testid" "you-status-form" ]
                    [ label [ class "a2-label", for "you-status-input" ] [ text "Custom status" ]
                    , input
                        [ id "you-status-input"
                        , class "a2-input"
                        , value draft
                        , maxlength App.maxCustomStatusLength
                        , placeholder "What are you up to?"
                        , onInput StatusEditInput
                        , attribute "data-testid" "you-status-input"
                        ]
                        []
                    , label [ class "a2-label", for "you-status-expiry" ] [ text "Clear after" ]
                    , select
                        [ id "you-status-expiry"
                        , class "a2-select"
                        , attribute "data-testid" "you-status-expiry"
                        , on "change" (Decode.map StatusExpiryChoose (Decode.at [ "target", "value" ] Decode.string))
                        ]
                        (List.map
                            (\choice -> option [ value choice.id, selected (model.statusExpiryChoice == choice.id) ] [ text choice.label ])
                            Account2.expiryChoices
                        )
                    , case model.statusError of
                        Just err ->
                            p [ class "a2-error", attribute "role" "alert" ] [ text err ]

                        Nothing ->
                            text ""
                    , div [ class "a2-row" ]
                        [ button [ type_ "submit", class "a2-btn a2-btn--primary", attribute "data-testid" "you-status-save" ] [ text "Save status" ]
                        , button [ type_ "button", class "a2-btn", onClick StatusEditCancel ] [ text "Cancel" ]
                        ]
                    ]
        ]


presenceOptions : List ( String, UserStatus, String )
presenceOptions =
    [ ( "online", StatusOnline, "Online" )
    , ( "idle", StatusIdle, "Away" )
    , ( "dnd", StatusDnd, "Do not disturb" )
    , ( "offline", StatusOffline, "Invisible" )
    ]


presenceMsg : String -> Msg
presenceMsg key =
    presenceOptions
        |> List.filter (\( k, _, _ ) -> k == key)
        |> List.head
        |> Maybe.map (\( _, status, _ ) -> UserStatusSet status)
        |> Maybe.withDefault (UserStatusSet StatusOnline)


{-| Extra You hub entries: People (friends / watch list) and theme
share/import. Same markup as the hub's own entries.
-}
youEntries : Model -> { people : Html Msg, themeShare : Html Msg }
youEntries model =
    let
        online =
            Dict.values model.friends |> List.filter .online |> List.length
    in
    { people =
        youEntry
            { testId = "you-open-people"
            , label = "People"
            , hint =
                if online > 0 then
                    "Friends and watch list · " ++ String.fromInt online ++ " online"

                else
                    "Friends and watch list"
            , msg = PeopleOpen
            }
    , themeShare =
        youEntry
            { testId = "you-open-theme-share"
            , label = "Share or import a theme"
            , hint = "Send your look to a friend, or try theirs"
            , msg = ThemeShareOpen
            }
    }


youEntry : { testId : String, label : String, hint : String, msg : Msg } -> Html Msg
youEntry e =
    button
        [ type_ "button"
        , class "onyx-you-link"
        , attribute "data-testid" e.testId
        , attribute "aria-haspopup" "dialog"
        , onClick e.msg
        ]
        [ span []
            [ strong [] [ text e.label ]
            , small [] [ text e.hint ]
            ]
        ]



-- PEOPLE SHEET


peopleSheet : Model -> Html Msg
peopleSheet model =
    if not model.peopleOpen then
        text ""

    else
        Sheet.view
            { scope = "people"
            , label = Sheet.LabelledBy (Sheet.titleId "people")
            , onClose = PeopleClose
            , placement = Sheet.Side
            , layerClass = ""
            , panelClass = "a2-sheet"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "people-sheet" ]
            }
            [ Sheet.header { scope = "people", title = "People", closeLabel = "Close people", onClose = PeopleClose, closeTestId = Just "people-close" }
            , div [ class "a2-body" ]
                [ p [ class "a2-hint" ] [ text "Friends and your watch list live on this device. Online status comes from the network while you're connected." ]
                , case model.peopleNotice of
                    Just notice ->
                        p [ class "a2-error", attribute "role" "alert", attribute "data-testid" "people-notice" ] [ text notice ]

                    Nothing ->
                        text ""
                , friendsSection model
                , watchSection model
                ]
            ]


friendsSection : Model -> Html Msg
friendsSection model =
    let
        friends =
            Account2.sortContacts (Dict.values model.friends)
    in
    section [ class "a2-section", attribute "aria-labelledby" "people-friends-title", attribute "data-testid" "people-friends" ]
        [ h3 [ class "a2-heading", id "people-friends-title" ] [ text "Friends" ]
        , addForm
            { inputId = "people-friend-input"
            , label = "Add a friend"
            , value = model.peopleFriendDraft
            , onInput = PeopleFriendDraft
            , onSubmit = PeopleFriendAdd
            , testId = "people-friend"
            , autofocus = True
            }
        , if List.isEmpty friends then
            p [ class "a2-faint", attribute "data-testid" "people-friends-empty" ] [ text "No friends yet. Add someone by name to see when they're online." ]

          else
            ul [ class "a2-list", attribute "aria-label" "Friends" ]
                (List.map
                    (\f ->
                        li [ class "a2-person", attribute "data-testid" ("people-friend-" ++ String.toLower f.nick), attribute "data-online" (boolAttr f.online) ]
                            [ span [ class "a2-dot", attribute "data-online" (boolAttr f.online), attribute "aria-hidden" "true" ] []
                            , span [ class "a2-person__copy" ]
                                [ strong [] [ text f.nick ]
                                , small [ class "a2-faint" ]
                                    [ text
                                        (if f.online then
                                            "Online"

                                         else
                                            "Offline"
                                        )
                                    ]
                                ]
                            , button
                                [ type_ "button"
                                , class "a2-btn"
                                , attribute "aria-label" ("Message " ++ f.nick)
                                , onClick (PeopleMessage f.nick)
                                ]
                                [ text "Message" ]
                            , button
                                [ type_ "button"
                                , class "a2-btn"
                                , attribute "aria-label" ("Remove " ++ f.nick ++ " from friends")
                                , onClick (PeopleFriendRemove f.nick)
                                ]
                                [ text "Remove" ]
                            ]
                    )
                    friends
                )
        ]


watchSection : Model -> Html Msg
watchSection model =
    let
        entries =
            Account2.sortContacts model.watchList
    in
    section [ class "a2-section", attribute "aria-labelledby" "people-watch-title", attribute "data-testid" "people-watch" ]
        [ h3 [ class "a2-heading", id "people-watch-title" ] [ text "Watch list" ]
        , p [ class "a2-hint" ] [ text "Know when someone comes online, without adding them as a friend." ]
        , addForm
            { inputId = "people-watch-input"
            , label = "Watch a name"
            , value = model.peopleWatchDraft
            , onInput = PeopleWatchDraft
            , onSubmit = PeopleWatchAdd
            , testId = "people-watch"
            , autofocus = False
            }
        , if List.isEmpty entries then
            p [ class "a2-faint", attribute "data-testid" "people-watch-empty" ] [ text "Nobody on your watch list." ]

          else
            ul [ class "a2-list", attribute "aria-label" "Watch list" ]
                (List.map
                    (\w ->
                        li [ class "a2-person", attribute "data-testid" ("people-watch-" ++ String.toLower w.nick), attribute "data-online" (boolAttr w.online) ]
                            [ span [ class "a2-dot", attribute "data-online" (boolAttr w.online), attribute "aria-hidden" "true" ] []
                            , span [ class "a2-person__copy" ]
                                [ strong [] [ text w.nick ]
                                , small [ class "a2-faint" ]
                                    [ text
                                        (if w.online then
                                            "Online"

                                         else
                                            Account2.lastSeenLabel w.lastSeenMs model.nowMs
                                        )
                                    ]
                                ]
                            , button
                                [ type_ "button"
                                , class "a2-btn"
                                , attribute "aria-label" ("Stop watching " ++ w.nick)
                                , onClick (PeopleWatchRemove w.nick)
                                ]
                                [ text "Remove" ]
                            ]
                    )
                    entries
                )
        ]


addForm :
    { inputId : String
    , label : String
    , value : String
    , onInput : String -> Msg
    , onSubmit : Msg
    , testId : String
    , autofocus : Bool
    }
    -> Html Msg
addForm cfg =
    form [ class "a2-add", onSubmit cfg.onSubmit ]
        [ label [ class "a2-label", for cfg.inputId ] [ text cfg.label ]
        , div [ class "a2-row a2-row--fill" ]
            [ input
                ([ id cfg.inputId
                 , class "a2-input"
                 , value cfg.value
                 , placeholder "Name"
                 , attribute "autocomplete" "off"
                 , attribute "data-testid" (cfg.testId ++ "-input")
                 , onInput cfg.onInput
                 ]
                    ++ (if cfg.autofocus then
                            [ Sheet.autofocus "people" ]

                        else
                            []
                       )
                )
                []
            , button
                [ type_ "submit"
                , class "a2-btn"
                , attribute "data-testid" (cfg.testId ++ "-add")
                , disabled (String.isEmpty (String.trim cfg.value))
                ]
                [ text "Add" ]
            ]
        ]



-- SIDEBAR PRESENCE


{-| A friend's online state for a DM peer, if they are a friend. -}
friendPresence : Model -> String -> Maybe Bool
friendPresence model nick =
    Dict.get (String.toLower nick) model.friends |> Maybe.map .online


{-| Suffix for the DM row's accessible name. -}
friendPresenceLabel : Model -> String -> String
friendPresenceLabel model nick =
    case friendPresence model nick of
        Just True ->
            ", friend, online"

        Just False ->
            ", friend, offline"

        Nothing ->
            ""


boolAttr : Bool -> String
boolAttr b =
    if b then
        "true"

    else
        "false"
