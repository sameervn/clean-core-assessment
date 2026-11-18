* Badi Implementation - ZIM_SCM_ROUTE

* Badi Definition Name - BADI_SD_ROUTE

* Imp Class - ZCL_IM_IM_SCM_ROUTE


METHOD if_ex_badi_sd_route~route_determination.

    DATA : lv_ligew  TYPE tvlgz-ligew,
           lv_limeh  TYPE tvlgz-limeh,
           lvt_brgew TYPE tvlgz-ligew.  "++ loc by ysatheesh

    FIELD-SYMBOLS: <fs_tweight> TYPE rv45a,
                   <fs_vbap>    TYPE tt_vbapvb.

    SELECT SINGLE low FROM tvarvc
                   INTO @DATA(lv_vkorg)
                   WHERE name EQ 'ZROUTE_UPD_CHECK_VKORG'
                   AND   type EQ 'S'
                   AND   opti EQ 'EQ'
                   AND   low  EQ @is_vbak-vkorg.
    IF sy-subrc = 0.

      ASSIGN ('(SAPMV45A)RV45A') TO <fs_tweight>.
      IF <fs_tweight> IS ASSIGNED.
*        BOC INC#82670 RGADIPARTHI  DS2K916769 02-04-2026
*        lv_ligew   = <fs_tweight>-btgew.
*        lv_limeh  = <fs_tweight>-gewei.
        IF <fs_tweight>-docnum IS INITIAL.
          lv_ligew   = <fs_tweight>-btgew.
          lv_limeh  = <fs_tweight>-gewei.
        ELSE.
          ASSIGN ('(SAPMV45A)XVBAP[]') TO <fs_vbap>.
          IF <fs_vbap> IS ASSIGNED.
            LOOP AT <fs_vbap> INTO DATA(ls_vbap).
              IF ls_vbap-abgru IS INITIAL.
                lvt_brgew = lvt_brgew + ls_vbap-brgew.
                lv_limeh = ls_vbap-gewei.
              ENDIF.
            ENDLOOP.
            lv_ligew = lvt_brgew.
            CLEAR: lvt_brgew.
          ENDIF.
*        EOC INC#82670 RGADIPARTHI  DS2K916769 02-04-2026
        ENDIF.
        CALL FUNCTION 'RV_WEIGHT_GROUP_DETERMINE'
          EXPORTING
            fligew    = lv_ligew
            flimeh    = lv_limeh
          IMPORTING
            fgrulg    = cv_grulg
          EXCEPTIONS
            not_found = 1
            OTHERS    = 2.
        IF sy-subrc <> 0.
* Implement suitable error handling here
        ENDIF.
        CLEAR : cv_tragr.
      ENDIF.

    ELSEIF is_vbak-vkorg IS NOT INITIAL.
*      BOC  INC#83466 RGADIPARTHI DS2K917510 03/14/2026
          SELECT SINGLE low FROM tvarvc
                   INTO @lv_vkorg
                   WHERE name EQ 'ZROUTE_NO_UPD_CHECK_VKORG'
                   AND   type EQ 'S'
                   AND   opti EQ 'EQ'
                   AND   low  EQ @is_vbak-vkorg.
            IF sy-subrc EQ 0.
               RAISE no_route_found.  "--LOC INC#83466 RGADIPARTHI 02/17/2026
            ENDIF.
*      BOC  INC#83466 RGADIPARTHI DS2K917510 02/14/2026
    ENDIF.

  ENDMETHOD.

