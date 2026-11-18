* /OPT/CL_C_IDX_UI_PLUGIN_IMAGE~PLUGIN_DATA_CONTEXT_SET-- ZENH_RTRE040_IMG_CONTORL_DP
    IF sy-tcode EQ '/OPT/VIM_VA2'.
      SELECT SINGLE
      docid,
      bukrs,
      lifnr
      FROM /OPT/VIM_1HEAD
      INTO @DATA(lwa_1head)
      WHERE docid EQ @lh_idx_application->mh_doc_processor->index_header-docid.
      IF sy-subrc EQ 0.
        SELECT SINGLE
        lifnr,
        bukrs,
        begru
        FROM lfb1
        WHERE lifnr EQ @lwa_1head-lifnr
        AND   bukrs EQ @lwa_1head-bukrs
        INTO @DATA(lwa_lfb1).
        IF sy-subrc EQ 0 AND  lwa_lfb1-begru IS NOT INITIAL.
          AUTHORITY-CHECK OBJECT 'Z_6NX_AP'
          ID 'ACTION' FIELD 'A'.
          IF sy-subrc <> 0.
            CLEAR : mv_archiv_id , mv_arc_doc_id.
          ENDIF.
        ENDIF.
      ENDIF.
    ENDIF.
