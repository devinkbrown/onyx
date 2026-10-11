module View.Nav exposing (mobileNav, navItems, primaryNav, youHub)

{-| Shell primary navigation + the You hub sheet.

`primaryNav` / `mobileNav` mirror `src/shell/PrimaryNavigation.tsx`:
one `Nav.items` model rendered as a slim desktop rail (`Primary`
landmark, `Quick switch to …` tooltips) and a bottom tab bar under
600px (v3/rx-shell; was 768px) (`Mobile navigation`, `Open …` names). Both always render; CSS
picks one per width. Collections carry `aria-pressed`/`aria-expanded`,
the current location `aria-current="page"`, You `aria-haspopup="dialog"`.

`youHub` mirrors the `YouSettings` list inside the account `You`
dialog (with the `YouHubNav` workspace links): identity (nick, guest vs
signed in), Account (signed in → the account panel; guest → "Keep this
name", the guest-claim sheet), This device → Appearance (the
`/appearance` route), Help (guides, about, status) and Leave. It is
available to guests and accounts alike. Narrowed: the device toggles,
language tools and Advanced group live in later slices (4.1).

-}

import App exposing (Model, Msg(..))
import Avatar
import Dict
import Html exposing (Html, button, div, h2, h3, nav, p, section, small, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, type_)
import Html.Events exposing (onClick)
import Nav
import Sidebar
import View.Account2
import View.Organize -- v3/gap-organize
import View.GapShell -- v3/gap-shell
import View.Sheet as Sheet
-- v3/calls-c8
import View.VoiceSettings


{-| The model for one variant, fed from shell state. -}
navItems : Nav.Variant -> Model -> List Nav.Item
navItems variant model =
    Nav.items
        { variant = variant
        , current = Just model.navSection
        , selectedCollection =
            if Nav.isCollection model.navSection then
                Just model.navSection

            else
                Nothing
        , expandedCollection =
            case variant of
                Nav.Desktop ->
                    Nothing

                Nav.Mobile ->
                    Just
                        (if model.navDrawerOpen && Nav.isCollection model.navSection then
                            Just model.navSection

                         else
                            Nothing
                        )
        , youDialogOpen = Just model.youHubOpen
        }


primaryNav : Model -> Html Msg
primaryNav model =
    nav
        [ class "onyx-primary-nav"
        , attribute "aria-label" "Primary"
        , attribute "data-primary-navigation" ""
        , attribute "data-primary-navigation-variant" "desktop"
        ]
        (span [ class "onyx-primary-nav-context" ] [ text "Quick switch" ]
            :: List.map (navButton model Nav.Desktop) (navItems Nav.Desktop model)
        )


mobileNav : Model -> Html Msg
mobileNav model =
    nav
        [ class "onyx-mobile-nav"
        , attribute "aria-label" "Mobile navigation"
        , attribute "data-primary-navigation" ""
        , attribute "data-primary-navigation-variant" "mobile"
        ]
        (List.map (navButton model Nav.Mobile) (navItems Nav.Mobile model))


boolAttr : String -> Bool -> Html.Attribute msg
boolAttr name on =
    attribute name
        (if on then
            "true"

         else
            "false"
        )


{-| v3/ui-mobile-shell — collection totals for the nav items: how many
rooms (or DMs) have something new, and whether any of them mentions
you (the accent glyph; plain unread stays neutral). -}
attention : Model -> Nav.Id -> { count : Int, mention : Bool }
attention model id =
    let
        inCollection channel =
            case id of
                Nav.Rooms ->
                    App.isChannelName model channel.name

                Nav.Messages ->
                    not (App.isChannelName model channel.name)

                _ ->
                    False

        waiting =
            model.channels
                |> Dict.values
                |> List.filter (\c -> inCollection c && Sidebar.hasAttention c)
    in
    { count = List.length waiting, mention = List.any (\c -> c.highlights > 0) waiting }


unreadSuffix : Nav.Id -> { count : Int, mention : Bool } -> String
unreadSuffix id att =
    if att.count == 0 then
        ""

    else
        ", "
            ++ String.fromInt att.count
            ++ (if att.mention && id == Nav.Rooms then
                    " with mentions"

                else
                    " unread"
               )


navButton : Model -> Nav.Variant -> Nav.Item -> Html Msg
navButton model variant item =
    let
        mobile =
            variant == Nav.Mobile

        att =
            attention model item.id

        title =
            if mobile then
                "Open " ++ item.label

            else
                "Quick switch to " ++ item.label

        optional =
            List.filterMap identity
                [ if mobile then
                    Just (attribute "aria-label" (item.actionLabel ++ unreadSuffix item.id att))

                  else
                    Nothing
                , if item.current then
                    Just (attribute "aria-current" "page")

                  else
                    Nothing
                , if Nav.isCollection item.id then
                    Just (boolAttr "aria-pressed" item.selected)

                  else
                    Nothing
                , Maybe.map (boolAttr "aria-expanded") item.expanded
                , Maybe.map (attribute "aria-haspopup") item.hasPopup
                , if item.selected then
                    Just (attribute "data-selected" "true")

                  else
                    Nothing
                ]
    in
    button
        ([ type_ "button"
         , classList
            [ ( "onyx-nav-btn", True )
            , ( "onyx-nav-btn--active", item.current )
            , ( "onyx-nav-btn--selected", item.selected )
            , ( "onyx-nav-btn--dialog-open", item.id == Nav.You && item.expanded == Just True )
            ]
         , attribute "data-primary-nav-item" ""
         , attribute "data-section" (Nav.idKey item.id)
         , attribute "data-testid" ("nav-" ++ Nav.idKey item.id)
         , attribute "title" title
         , onClick (NavSelect item.id)
         ]
            ++ optional
        )
        [ span [ class "onyx-nav-glyph", attribute "aria-hidden" "true" ]
            [ span
                [ class "onyx-nav-icon"
                , attribute "data-icon" (Nav.idKey item.id)
                ]
                []
            , if att.count > 0 then
                span
                    [ classList [ ( "onyx-nav-badge", True ), ( "onyx-nav-badge--mention", att.mention ) ] ]
                    [ text
                        (if att.count > 9 then
                            "9+"

                         else
                            String.fromInt att.count
                        )
                    ]

              else
                text ""
            ]
        , span [ class "onyx-nav-label" ]
            [ text item.label
            , -- v3/rx-shell: the rail's hover / focus label spells the
              -- total out ("Rooms, 3 unread"), so it reads beyond the badge
              if not mobile && att.count > 0 then
                span [ class "onyx-nav-label-count" ] [ text (unreadSuffix item.id att) ]

              else
                text ""
            ]
        ]


{-| The You hub sheet — for guests and accounts. -}
youHub : Model -> Html Msg
youHub model =
    if not model.youHubOpen then
        text ""

    else
        let
            guest =
                model.accountName == Nothing

            nick =
                String.trim model.ourNick

            description =
                case model.accountName of
                    Just account ->
                        "Signed in as " ++ account

                    Nothing ->
                        "You are browsing as a guest."
        in
        Sheet.view
            { scope = "you"
            , label = Sheet.Labelled "You"
            , onClose = YouHubClose
            , placement = Sheet.Center
            , layerClass = "onyx-you-veil"
            , panelClass = "onyx-you"
            , backdropClass = ""
            , layerAttrs = []
            , modal = True
            , attrs = [ attribute "data-testid" "you-hub", attribute "data-guest" (boolString guest) ]
            }
                [ div [ class "onyx-you-head" ]
                    [ span [ class "onyx-face onyx-you-avatar", attribute "aria-hidden" "true" ] [ text (Avatar.initials nick) ]
                    , div [ class "onyx-you-identity" ]
                        [ h2 [ class "onyx-you-title" ] [ text "You" ]
                        , p [ class "onyx-you-nick", attribute "data-testid" "you-nick" ]
                            [ text
                                (if String.isEmpty nick then
                                    "No name yet"

                                 else
                                    nick
                                )
                            ]
                        , p [ class "onyx-you-desc" ] [ text description ]
                        , youConnection model
                        , -- v3/account2
                          View.Account2.youStatusBlock model
                        ]
                    , button
                        [ type_ "button"
                        , class "onyx-you-close"
                        , attribute "aria-label" "Close You"
                        , attribute "data-testid" "you-close"
                        , onClick YouHubClose
                        ]
                        [ span [ class "onyx-shi", attribute "data-icon" "close", attribute "aria-hidden" "true" ] [] ]
                    ]
                , nav [ class "onyx-you-settings", attribute "aria-label" "You settings", attribute "data-testid" "you-settings" ]
                    [ p [ class "onyx-you-lede", attribute "role" "note" ]
                        [ text
                            (if guest then
                                "Keep this name if you want to protect it without disconnecting."

                             else
                                "Your account travels with you. Everything else here changes this device only."
                            )
                        ]
                    , group "account" "Account" Nothing
                        [ if guest then
                            entry
                                { testId = "you-keep-name"
                                , label = "Keep this name"
                                , hint = "Register the name you are using without reconnecting"
                                , popup = True
                                , action = Nav.YouAccount
                                }

                          else
                            entry
                                { testId = "you-open-account"
                                , label = "Account"
                                , hint = "Identity, protection, and account data"
                                , popup = True
                                , action = Nav.YouAccount
                                }
                        ]
                    , group "device" "This device" Nothing
                        [ -- v3/ui-mobile-shell: moved here from the global bar
                          button
                            [ type_ "button"
                            , class "onyx-you-link"
                            , attribute "data-testid" "shell-notifications"
                            , attribute "aria-label" "Notifications"
                            , attribute "aria-haspopup" "dialog"
                            , onClick NotifySheetOpen
                            ]
                            [ span []
                                [ strong [] [ text "Notifications" ]
                                , small [] [ text "Alerts, sounds, keywords, and quiet hours" ]
                                ]
                            ]
                        , entry
                            { testId = "you-settings-open-appearance"
                            , label = "Appearance"
                            , hint = "Look, text size, and motion"
                            , popup = False
                            , action = Nav.YouAppearance
                            }
                        , entry
                            { testId = "you-settings-open-preferences"
                            , label = "Preferences"
                            , hint = "Display, accessibility, history, and queued sends"
                            , popup = True
                            , action = Nav.YouPreferences
                            }

                        -- v3/calls-c8
                        , View.VoiceSettings.youEntry
                        -- v3/gap-organize
                        , View.Organize.youEntry model
                        -- v3/account2
                        , (View.Account2.youEntries model).people
                        , (View.Account2.youEntries model).themeShare
                        ]
                    , group "help" "Help" Nothing
                        [ View.GapShell.youEntry model -- v3/gap-shell
                        , entry
                            { testId = "you-open-guides"
                            , label = "Guides"
                            , hint = "How Onyx works, step by step"
                            , popup = False
                            , action = Nav.YouGuides
                            }
                        , entry
                            { testId = "you-open-about"
                            , label = "About Onyx"
                            , hint = "What Onyx is and who runs it"
                            , popup = False
                            , action = Nav.YouAbout
                            }
                        , entry
                            { testId = "you-open-status"
                            , label = "Network status"
                            , hint = "Are the rooms up?"
                            , popup = False
                            , action = Nav.YouStatus
                            }
                        ]
                    , div [ class "onyx-you-leave-row" ]
                        [ button
                            [ type_ "button"
                            , class "onyx-you-leave"
                            , attribute "aria-label" "Disconnect from Onyx"
                            , attribute "data-testid" "you-leave"
                            , onClick (YouHubGo Nav.YouLeave)
                            ]
                            [ text "Leave Onyx" ]
                        ]
                    ]
                ]


{-| v3/ui-mobile-shell — the connection state (the global pill hides
on phones). -}
youConnection : Model -> Html Msg
youConnection model =
    let
        ( key, words ) =
            case model.connection of
                App.Live ->
                    ( "live", "Connected" )

                App.Registering ->
                    ( "connecting", "Connecting…" )

                App.Offline ->
                    ( "offline", "Offline — messages queue on this device" )
    in
    p [ class "onyx-you-conn", attribute "data-state" key, attribute "data-testid" "you-connection" ]
        [ span [ class "onyx-you-conn-dot", attribute "aria-hidden" "true" ] []
        , text words
        ]


boolString : Bool -> String
boolString b =
    if b then
        "true"

    else
        "false"


group : String -> String -> Maybe String -> List (Html Msg) -> Html Msg
group key title hint children =
    section
        [ class "onyx-you-group"
        , attribute "aria-labelledby" ("you-group-" ++ key ++ "-title")
        ]
        ([ h3 [ class "onyx-you-group__title", Html.Attributes.id ("you-group-" ++ key ++ "-title") ] [ text title ] ]
            ++ (case hint of
                    Just h ->
                        [ p [ class "onyx-you-group__hint" ] [ text h ] ]

                    Nothing ->
                        []
               )
            ++ children
        )


entry : { testId : String, label : String, hint : String, popup : Bool, action : Nav.YouAction } -> Html Msg
entry e =
    button
        ([ type_ "button"
         , class "onyx-you-link"
         , attribute "data-testid" e.testId
         , onClick (YouHubGo e.action)
         ]
            ++ (if e.action == Nav.YouAppearance then
                    [ attribute "aria-label" "Open appearance settings" ]

                else
                    []
               )
            ++ (if e.popup then
                    [ attribute "aria-haspopup" "dialog" ]

                else
                    []
               )
        )
        [ span []
            [ strong [] [ text e.label ]
            , small [] [ text e.hint ]
            ]
        ]
