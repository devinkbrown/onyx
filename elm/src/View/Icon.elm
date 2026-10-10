module View.Icon exposing (icon)

{-| v3/ui-messages — one decorative stroke icon.

An empty span the stylesheet paints with a CSS mask
(`.pt-ico[data-icon=…]` in css/pol-thread.css, drawn from inline SVG
data URIs), so no icon ever depends on a glyph the platform font may
lack. It is always `aria-hidden`: the control around it carries the
accessible name.

-}

import Html exposing (Html, span)
import Html.Attributes exposing (attribute, class)


icon : String -> Html msg
icon name =
    span [ class "pt-ico", attribute "data-icon" name, attribute "aria-hidden" "true" ] []
