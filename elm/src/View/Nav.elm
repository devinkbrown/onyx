module View.Nav exposing (mobileNav, navItems, primaryNav, youHub)

{-| Shell primary navigation + the You hub sheet.

`primaryNav` / `mobileNav` mirror `src/shell/PrimaryNavigation.tsx`:
one `Nav.items` model rendered as a slim desktop rail (`Primary`
landmark, `Quick switch to …` tooltips) and a bottom tab bar under
720px (`Mobile navigation`, `Open …` names). Both always render; CSS
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
import Html exposing (Html, button, div, h2, h3, nav, p, section, small, span, strong, text)
import Html.Attributes exposing (attribute, class, classList, type_)
import Html.Events exposing (onClick)
import Nav


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
            :: List.map (navButton Nav.Desktop) (navItems Nav.Desktop model)
        )


mobileNav : Model -> Html Msg
mobileNav model =
    nav
        [ class "onyx-mobile-nav"
        , attribute "aria-label" "Mobile navigation"
        , attribute "data-primary-navigation" ""
        , attribute "data-primary-navigation-variant" "mobile"
        ]
        (List.map (navButton Nav.Mobile) (navItems Nav.Mobile model))


boolAttr : String -> Bool -> Html.Attribute msg
boolAttr name on =
    attribute name
        (if on then
            "true"

         else
            "false"
        )


navButton : Nav.Variant -> Nav.Item -> Html Msg
navButton variant item =
    let
        mobile =
            variant == Nav.Mobile

        title =
            if mobile then
                "Open " ++ item.label

            else
                "Quick switch to " ++ item.label

        optional =
            List.filterMap identity
                [ if mobile then
                    Just (attribute "aria-label" item.actionLabel)

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
        [ span
            [ class "onyx-nav-icon"
            , attribute "data-icon" (Nav.idKey item.id)
            , attribute "aria-hidden" "true"
            ]
            []
        , span [ class "onyx-nav-label" ] [ text item.label ]
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
        div [ class "onyx-you-veil" ]
            [ div
                [ class "onyx-you"
                , attribute "role" "dialog"
                , attribute "aria-modal" "true"
                , attribute "aria-label" "You"
                , attribute "data-testid" "you-hub"
                , attribute "data-guest" (boolString guest)
                ]
                [ div [ class "onyx-you-head" ]
                    [ div [ class "onyx-you-identity" ]
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
                        ]
                    , button
                        [ type_ "button"
                        , class "onyx-you-close"
                        , attribute "aria-label" "Close You"
                        , attribute "data-testid" "you-close"
                        , onClick YouHubClose
                        ]
                        [ span [ attribute "aria-hidden" "true" ] [ text "✕" ] ]
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
                    , group "account" "Account" (Just "Sign-in, recovery, and account data. These choices travel with the account.")
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
                    , group "device" "This device" (Just "Notifications, privacy, reading, and hardware on this browser.")
                        [ entry
                            { testId = "you-settings-open-appearance"
                            , label = "Appearance"
                            , hint = "Look, text size, and motion"
                            , popup = False
                            , action = Nav.YouAppearance
                            }
                        ]
                    , group "help" "Help" Nothing
                        [ entry
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
                            [ text "Leave" ]
                        ]
                    ]
                ]
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
