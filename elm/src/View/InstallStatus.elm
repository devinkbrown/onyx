module View.InstallStatus exposing (view)

{-| Accessible update status copy with an explicit activation action. -}

import Html exposing (Html, button, div, p, text)
import Html.Attributes exposing (attribute, class, disabled)
import Html.Events exposing (onClick)
import WorkerLifecycle exposing (Msg(..), Status(..))


view : Status -> String -> Bool -> Html Msg
view status targetBuildId busy =
    let
        ( title, detail, canActivate ) =
            case status of
                Unsupported -> ( "Updates unavailable", "This browser cannot install background updates.", False )
                Unregistered -> ( "Update check needed", "Check for an available Onyx update.", False )
                Installing -> ( "Preparing update", "Onyx is downloading the safe app shell.", False )
                Waiting -> ( "Update ready", "The update will wait until open tabs are safe.", True )
                BlockedByClients count -> ( "Update waiting", String.fromInt count ++ " open tab(s) still need attention.", True )
                Activating -> ( "Updating Onyx", "Open tabs are ready. The new shell is activating.", False )
                Ready -> ( "Onyx is up to date", "The current app shell is active.", False )
                Failed _ -> ( "Update could not finish", "Your current tab remains open. You can try again later.", False )
    in
    div [ class "onyx-install-status", attribute "role" "status", attribute "aria-live" "polite" ]
        [ p [] [ text title ]
        , p [] [ text detail ]
        , if canActivate then
            button [ typeButton, disabled (busy || String.isEmpty targetBuildId), onClick (ActivationRequested "user-activation" targetBuildId) ] [ text "Install update when safe" ]

          else
            text ""
        ]


typeButton : Html.Attribute msg
typeButton =
    Html.Attributes.type_ "button"
